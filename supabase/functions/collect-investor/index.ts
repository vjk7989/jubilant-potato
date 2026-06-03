import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(supabaseUrl, serviceRoleKey);

const requiredText = (value: unknown) =>
  typeof value === "string" && value.trim().length > 0;

const maxCategoryProofBytes = 7 * 1024 * 1024;
const allowedProofCategories = new Set(["payment", "payout"]);

const getProofBytesByCategory = (proofFiles: Array<Record<string, unknown>>) =>
  proofFiles.reduce<Record<string, number>>((totals, file) => {
    const category = typeof file.proof_category === "string" ? file.proof_category : "";
    const sizeBytes = typeof file.size_bytes === "number" ? file.size_bytes : 0;
    totals[category] = (totals[category] ?? 0) + Math.max(sizeBytes, 0);
    return totals;
  }, {});

const hasPaymentProof = (proofFiles: Array<Record<string, unknown>>) =>
  proofFiles.some((file) => file.proof_category === "payment");

const hasOnlyAllowedProofCategories = (proofFiles: Array<Record<string, unknown>>) =>
  proofFiles.every(
    (file) =>
      typeof file.proof_category === "string" &&
      allowedProofCategories.has(file.proof_category),
  );

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return Response.json(
      { message: "Method not allowed." },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const body = await request.json();

    if (
      !requiredText(body.full_name) ||
      !requiredText(body.phone_number) ||
      !requiredText(body.resident_state) ||
      !requiredText(body.resident_district) ||
      !Array.isArray(body.tds_details) ||
      body.tds_details.length === 0 ||
      !Array.isArray(body.proof_files) ||
      body.proof_files.length === 0 ||
      !requiredText(body.device_id) ||
      !requiredText(body.device_fingerprint) ||
      !requiredText(body.device_daily_key) ||
      typeof body.amount_invested !== "number" ||
      body.amount_invested < 0
    ) {
      return Response.json(
        { message: "Missing or invalid required fields." },
        { status: 400, headers: corsHeaders },
      );
    }

    const proofBytesByCategory = getProofBytesByCategory(body.proof_files);
    if (!hasOnlyAllowedProofCategories(body.proof_files)) {
      return Response.json(
        { message: "Proof files must be categorized as payment or payout." },
        { status: 400, headers: corsHeaders },
      );
    }

    if (!hasPaymentProof(body.proof_files)) {
      return Response.json(
        { message: "Upload at least one proof of payment document." },
        { status: 400, headers: corsHeaders },
      );
    }

    if ((proofBytesByCategory.payment ?? 0) > maxCategoryProofBytes) {
      return Response.json(
        { message: "Proof of payment files cannot exceed 7 MB total." },
        { status: 400, headers: corsHeaders },
      );
    }

    if ((proofBytesByCategory.payout ?? 0) > maxCategoryProofBytes) {
      return Response.json(
        { message: "Proof of payout receipt files cannot exceed 7 MB total." },
        { status: 400, headers: corsHeaders },
      );
    }

    const forwardedFor = request.headers.get("x-forwarded-for");
    const ipAddress =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") ||
      request.headers.get("fly-client-ip") ||
      forwardedFor?.split(",")[0]?.trim() ||
      (requiredText(body.ip_address) ? body.ip_address.trim() : null);
    const userAgent = request.headers.get("user-agent");

    const submissionId = requiredText(body.id) ? body.id.trim() : crypto.randomUUID();
    const { error } = await supabase.from("investor_submissions").insert({
      id: submissionId,
      full_name: body.full_name.trim(),
      phone_number: body.phone_number.trim(),
      email: requiredText(body.email) ? body.email.trim() : null,
      amount_invested: body.amount_invested,
      resident_state: body.resident_state.trim(),
      resident_district: body.resident_district.trim(),
      tds_details: body.tds_details,
      case_filed: Boolean(body.case_filed),
      case_types: Array.isArray(body.case_types) ? body.case_types : [],
      case_details: requiredText(body.case_details) ? body.case_details.trim() : null,
      case_proof_link: requiredText(body.case_proof_link)
        ? body.case_proof_link.trim()
        : null,
      proof_link: requiredText(body.proof_link) ? body.proof_link.trim() : null,
      proof_files: body.proof_files,
      device_id: body.device_id.trim(),
      device_fingerprint: body.device_fingerprint.trim(),
      device_submission_day: requiredText(body.device_submission_day)
        ? body.device_submission_day.trim()
        : new Date().toISOString().slice(0, 10),
      device_daily_key: body.device_daily_key.trim(),
      entered_at: body.entered_at,
      ip_address: ipAddress,
      user_agent: userAgent,
      device_details: {
        ...(body.device_details ?? {}),
        server_request: {
          user_agent: userAgent,
          forwarded_for: forwardedFor,
          cf_connecting_ip: request.headers.get("cf-connecting-ip"),
          x_real_ip: request.headers.get("x-real-ip"),
          fly_client_ip: request.headers.get("fly-client-ip"),
        },
      },
    });

    if (error) {
      throw error;
    }

    const proofFileRows = body.proof_files.map((file: Record<string, unknown>) => ({
      submission_id: submissionId,
      bucket_id: typeof file.bucket === "string" ? file.bucket : "investor-proofs",
      object_path: typeof file.path === "string" ? file.path : "",
      proof_category:
        typeof file.proof_category === "string" ? file.proof_category : "payment",
      original_name:
        typeof file.original_name === "string" ? file.original_name : "proof-file",
      mime_type: typeof file.mime_type === "string" ? file.mime_type : null,
      size_bytes: typeof file.size_bytes === "number" ? file.size_bytes : 0,
      uploaded_at:
        typeof file.uploaded_at === "string" ? file.uploaded_at : new Date().toISOString(),
    }));

    const { error: proofFileError } = await supabase
      .from("investor_proof_files")
      .insert(proofFileRows);

    if (proofFileError) {
      throw proofFileError;
    }

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500, headers: corsHeaders },
    );
  }
});
