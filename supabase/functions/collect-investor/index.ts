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
      !requiredText(body.proof_link) ||
      typeof body.amount_invested !== "number" ||
      body.amount_invested < 0
    ) {
      return Response.json(
        { message: "Missing or invalid required fields." },
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

    const { error } = await supabase.from("investor_submissions").insert({
      full_name: body.full_name.trim(),
      phone_number: body.phone_number.trim(),
      email: requiredText(body.email) ? body.email.trim() : null,
      amount_invested: body.amount_invested,
      case_filed: Boolean(body.case_filed),
      case_types: Array.isArray(body.case_types) ? body.case_types : [],
      case_details: requiredText(body.case_details) ? body.case_details.trim() : null,
      proof_link: body.proof_link.trim(),
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

    return Response.json({ ok: true }, { headers: corsHeaders });
  } catch (error) {
    return Response.json(
      { message: error instanceof Error ? error.message : "Unexpected error." },
      { status: 500, headers: corsHeaders },
    );
  }
});
