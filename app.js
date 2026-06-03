import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { INDIAN_DISTRICTS } from "./districts.js";

const SUPABASE_URL = "https://bnvnwkzeadpvxxssueif.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_SuU9RXdL0FMNPfDZO3zJ5Q_ky-ocXif";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const form = document.querySelector("#investor-form");
const statusMessage = document.querySelector("#statusMessage");
const submitButton = document.querySelector("#submitButton");
const caseFiled = document.querySelector("#caseFiled");
const caseDetailsPanel = document.querySelector("#caseDetailsPanel");
const ledgerBody = document.querySelector("#ledgerBody");
const ledgerStatus = document.querySelector("#ledgerStatus");
const ledgerSearch = document.querySelector("#ledgerSearch");
const refreshLedger = document.querySelector("#refreshLedger");
const totalAmount = document.querySelector("#totalAmount");
const totalVictims = document.querySelector("#totalVictims");
const totalCases = document.querySelector("#totalCases");
const proofFilesInput = document.querySelector("#proofFiles");
const proofDropZone = document.querySelector("#proofDropZone");
const fileList = document.querySelector("#fileList");
const tdsRows = document.querySelector("#tdsRows");
const addTdsRowButton = document.querySelector("#addTdsRow");
const stateSelect = document.querySelector("#state");
const districtSelect = document.querySelector("#district");

const PROOF_BUCKET = "investor-proofs";
const MAX_TOTAL_PROOF_BYTES = 20 * 1024 * 1024;
const DAILY_SUBMISSION_LIMIT = 3;
const DEVICE_ID_STORAGE_KEY = "shares_bazaar_device_id";
const DAILY_SUBMISSIONS_STORAGE_KEY = "shares_bazaar_daily_submissions";
let publicLedgerRows = [];
let selectedProofFiles = [];
let volatileDeviceId = null;

const setStatus = (message, type = "") => {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
};

const safeRun = async (reader, fallback = null) => {
  try {
    return await reader();
  } catch {
    return fallback;
  }
};

const fetchJsonWithTimeout = async (url, timeoutMs = 3500) => {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Request failed with ${response.status}`);
    }

    return await response.json();
  } finally {
    window.clearTimeout(timeoutId);
  }
};

const listFrom = (value, mapper = (item) => item) => {
  try {
    return Array.from(value ?? [], mapper);
  } catch {
    return [];
  }
};

const getStorageAvailability = (storage) => {
  const testKey = "__sb_storage_test__";
  try {
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
};

const getBrowserStorageAvailability = (storageName) =>
  safeRun(() => getStorageAvailability(window[storageName]), false);

const cleanText = (value, maxLength = 500) =>
  String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLength);

const getStoredValue = (key) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStoredValue = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const getRandomId = () => {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getOrCreateDeviceId = () => {
  const storedDeviceId = cleanText(getStoredValue(DEVICE_ID_STORAGE_KEY), 128);

  if (storedDeviceId) {
    return storedDeviceId;
  }

  if (!volatileDeviceId) {
    volatileDeviceId = getRandomId();
    setStoredValue(DEVICE_ID_STORAGE_KEY, volatileDeviceId);
  }

  return volatileDeviceId;
};

const getCurrentSubmissionDay = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const createDeviceSubmissionWindow = (
  deviceFingerprint = "",
  deviceId = getOrCreateDeviceId(),
) => {
  const device_submission_day = getCurrentSubmissionDay();
  const safeDeviceId = cleanText(deviceId, 128);

  return {
    device_id: safeDeviceId,
    device_fingerprint: cleanText(deviceFingerprint, 128),
    device_submission_day,
    device_daily_key: `${safeDeviceId}:${device_submission_day}`,
  };
};

const getLocalSubmissionLog = () => {
  try {
    const parsed = JSON.parse(getStoredValue(DAILY_SUBMISSIONS_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const getLocalSubmissionCount = (deviceDailyKey) => {
  const count = Number(getLocalSubmissionLog()[deviceDailyKey] || 0);
  return Number.isFinite(count) ? count : 0;
};

const recordSuccessfulDeviceSubmission = (deviceDailyKey) => {
  const log = getLocalSubmissionLog();
  log[deviceDailyKey] = Math.min(
    DAILY_SUBMISSION_LIMIT,
    Number(log[deviceDailyKey] || 0) + 1,
  );
  setStoredValue(DAILY_SUBMISSIONS_STORAGE_KEY, JSON.stringify(log));
};

const getDeviceFingerprint = async (deviceDetails) => {
  const fingerprintSource = JSON.stringify({
    user_agent: deviceDetails.user_agent,
    user_agent_data: deviceDetails.user_agent_data,
    platform: deviceDetails.platform,
    language: deviceDetails.language,
    timezone: deviceDetails.timezone,
    screen: deviceDetails.screen,
    hardware_concurrency: deviceDetails.hardware_concurrency,
    device_memory_gb: deviceDetails.device_memory_gb,
    max_touch_points: deviceDetails.max_touch_points,
    web_gl: deviceDetails.browser_features?.web_gl,
  });

  try {
    const bytes = new TextEncoder().encode(fingerprintSource);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  } catch {
    let hash = 0;
    for (let index = 0; index < fingerprintSource.length; index += 1) {
      hash = Math.imul(31, hash) + fingerprintSource.charCodeAt(index);
      hash |= 0;
    }

    return `fallback-${Math.abs(hash)}-${fingerprintSource.length}`;
  }
};

const getWebGlDetails = () =>
  safeRun(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");

    if (!context) {
      return { supported: false };
    }

    const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
    return {
      supported: true,
      vendor: context.getParameter(context.VENDOR),
      renderer: context.getParameter(context.RENDERER),
      version: context.getParameter(context.VERSION),
      shading_language_version: context.getParameter(context.SHADING_LANGUAGE_VERSION),
      unmasked_vendor: debugInfo
        ? context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)
        : null,
      unmasked_renderer: debugInfo
        ? context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
        : null,
      max_texture_size: context.getParameter(context.MAX_TEXTURE_SIZE),
      max_viewport_dims: context.getParameter(context.MAX_VIEWPORT_DIMS),
      extensions: context.getSupportedExtensions(),
    };
  });

const getUserAgentData = () =>
  safeRun(async () => {
    if (!navigator.userAgentData) {
      return null;
    }

    const highEntropyValues = await navigator.userAgentData.getHighEntropyValues([
      "architecture",
      "bitness",
      "brands",
      "formFactor",
      "fullVersionList",
      "mobile",
      "model",
      "platform",
      "platformVersion",
      "uaFullVersion",
      "wow64",
    ]);

    return {
      brands: navigator.userAgentData.brands,
      mobile: navigator.userAgentData.mobile,
      platform: navigator.userAgentData.platform,
      high_entropy_values: highEntropyValues,
    };
  });

const getBatteryDetails = () =>
  safeRun(async () => {
    if (!navigator.getBattery) {
      return null;
    }

    const battery = await navigator.getBattery();
    return {
      charging: battery.charging,
      charging_time_seconds: battery.chargingTime,
      discharging_time_seconds: battery.dischargingTime,
      level: battery.level,
    };
  });

const getStorageEstimate = () =>
  safeRun(async () => {
    if (!navigator.storage?.estimate) {
      return null;
    }

    const estimate = await navigator.storage.estimate();
    return {
      quota_bytes: estimate.quota ?? null,
      usage_bytes: estimate.usage ?? null,
      usage_details: estimate.usageDetails ?? null,
    };
  });

const getMediaDeviceDetails = () =>
  safeRun(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return null;
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.map((device) => ({
      kind: device.kind,
      label: device.label || null,
      device_id_available: Boolean(device.deviceId),
      group_id_available: Boolean(device.groupId),
    }));
  }, []);

const getPermissionStates = () =>
  safeRun(async () => {
    if (!navigator.permissions?.query) {
      return null;
    }

    const permissionNames = [
      "camera",
      "microphone",
      "geolocation",
      "notifications",
      "persistent-storage",
      "midi",
      "clipboard-read",
      "clipboard-write",
    ];
    const entries = await Promise.all(
      permissionNames.map(async (name) => [
        name,
        await safeRun(async () => (await navigator.permissions.query({ name })).state),
      ]),
    );

    return Object.fromEntries(entries);
  });

const getConnectionDetails = () => {
  const connection =
    navigator.connection || navigator.mozConnection || navigator.webkitConnection;

  if (!connection) {
    return null;
  }

  return {
    effective_type: connection.effectiveType ?? null,
    type: connection.type ?? null,
    downlink_mbps: connection.downlink ?? null,
    downlink_max_mbps: connection.downlinkMax ?? null,
    rtt_ms: connection.rtt ?? null,
    save_data: connection.saveData ?? null,
  };
};

const getPublicIpDetails = () =>
  safeRun(async () => {
    const data = await fetchJsonWithTimeout("https://api64.ipify.org?format=json");

    if (!data?.ip) {
      return null;
    }

    return {
      ip: data.ip,
      source: "api64.ipify.org",
      collected_at: new Date().toISOString(),
    };
  });

const getDeviceDetails = async () => ({
  collected_at: new Date().toISOString(),
  user_agent: navigator.userAgent,
  user_agent_data: await getUserAgentData(),
  app: {
    code_name: navigator.appCodeName,
    name: navigator.appName,
    version: navigator.appVersion,
    product: navigator.product,
    product_sub: navigator.productSub,
    vendor: navigator.vendor,
    vendor_sub: navigator.vendorSub,
  },
  language: {
    primary: navigator.language,
    languages: navigator.languages,
  },
  platform: navigator.platform,
  os_cpu: navigator.oscpu ?? null,
  device_memory_gb: navigator.deviceMemory ?? null,
  hardware_concurrency: navigator.hardwareConcurrency ?? null,
  max_touch_points: navigator.maxTouchPoints ?? null,
  pdf_viewer_enabled: navigator.pdfViewerEnabled ?? null,
  cookie_enabled: navigator.cookieEnabled,
  do_not_track: navigator.doNotTrack ?? window.doNotTrack ?? null,
  webdriver: navigator.webdriver ?? null,
  online: navigator.onLine,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  timezone_offset_minutes: new Date().getTimezoneOffset(),
  screen: {
    width: window.screen.width,
    height: window.screen.height,
    available_width: window.screen.availWidth,
    available_height: window.screen.availHeight,
    color_depth: window.screen.colorDepth,
    pixel_depth: window.screen.pixelDepth,
    orientation_type: window.screen.orientation?.type ?? null,
    orientation_angle: window.screen.orientation?.angle ?? null,
    pixel_ratio: window.devicePixelRatio,
  },
  viewport: {
    inner_width: window.innerWidth,
    inner_height: window.innerHeight,
    outer_width: window.outerWidth,
    outer_height: window.outerHeight,
    visual_viewport_width: window.visualViewport?.width ?? null,
    visual_viewport_height: window.visualViewport?.height ?? null,
    visual_viewport_scale: window.visualViewport?.scale ?? null,
  },
  page: {
    href: window.location.href,
    origin: window.location.origin,
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    referrer: document.referrer || null,
    title: document.title,
  },
  browser_features: {
    local_storage_available: await getBrowserStorageAvailability("localStorage"),
    session_storage_available: await getBrowserStorageAvailability("sessionStorage"),
    indexed_db_available: "indexedDB" in window,
    service_worker_available: "serviceWorker" in navigator,
    web_rtc_available: "RTCPeerConnection" in window,
    web_gl: await getWebGlDetails(),
  },
  network: getConnectionDetails(),
  battery: await getBatteryDetails(),
  storage_estimate: await getStorageEstimate(),
  media_devices: await getMediaDeviceDetails(),
  permissions: await getPermissionStates(),
  plugins: listFrom(navigator.plugins, (plugin) => ({
    name: plugin.name,
    filename: plugin.filename,
    description: plugin.description,
  })),
  mime_types: listFrom(navigator.mimeTypes, (mimeType) => ({
    type: mimeType.type,
    suffixes: mimeType.suffixes,
    description: mimeType.description,
  })),
});

const getValue = (id, maxLength = 500) =>
  cleanText(document.querySelector(`#${id}`).value, maxLength);

const getSelectedCaseTypes = () =>
  Array.from(document.querySelectorAll('input[name="caseType"]:checked')).map(
    (input) => input.value,
  );

const populateDistricts = () => {
  const districts = INDIAN_DISTRICTS[stateSelect.value] ?? [];
  while (districtSelect.firstChild) {
    districtSelect.removeChild(districtSelect.firstChild);
  }

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = districts.length ? "Select district" : "Select state first";
  districtSelect.appendChild(placeholder);

  districts.forEach((district) => {
    const option = document.createElement("option");
    option.value = district;
    option.textContent = district;
    districtSelect.appendChild(option);
  });

  districtSelect.disabled = districts.length === 0;
};

const getFinancialYearOptions = () => {
  const now = new Date();
  const currentYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const years = [];

  for (let year = 2017; year <= currentYear; year += 1) {
    years.push(`${year}-${year + 1}`);
  }

  return years;
};

const createTdsRow = () => {
  const row = document.createElement("div");
  const yearLabel = document.createElement("label");
  const amountLabel = document.createElement("label");
  const yearText = document.createElement("span");
  const amountText = document.createElement("span");
  const yearSelect = document.createElement("select");
  const amountInput = document.createElement("input");
  const removeButton = document.createElement("button");

  row.className = "tds-row";
  yearLabel.className = "field";
  amountLabel.className = "field";
  yearSelect.className = "tds-year";
  amountInput.className = "tds-amount";
  removeButton.className = "remove-row-button";

  yearText.textContent = "Financial year";
  amountText.textContent = "TDS amount";
  yearSelect.required = true;
  yearSelect.name = "tdsFinancialYear";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select year";
  yearSelect.appendChild(placeholder);
  getFinancialYearOptions().forEach((year) => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = year;
    yearSelect.appendChild(option);
  });

  amountInput.name = "tdsAmount";
  amountInput.type = "number";
  amountInput.inputMode = "decimal";
  amountInput.min = "0";
  amountInput.step = "0.01";
  amountInput.required = true;
  amountInput.placeholder = "Enter TDS amount";
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => {
    if (tdsRows.children.length > 1) {
      row.remove();
    }
  });

  yearLabel.append(yearText, yearSelect);
  amountLabel.append(amountText, amountInput);
  row.append(yearLabel, amountLabel, removeButton);
  tdsRows.appendChild(row);
};

const resetTdsRows = () => {
  while (tdsRows.firstChild) {
    tdsRows.removeChild(tdsRows.firstChild);
  }

  createTdsRow();
};

const getTdsDetails = () =>
  Array.from(document.querySelectorAll(".tds-row")).map((row) => ({
    financial_year: row.querySelector(".tds-year").value,
    amount: Number(row.querySelector(".tds-amount").value),
  }));

const hasDuplicateTdsYears = () => {
  const years = getTdsDetails().map((detail) => detail.financial_year);
  return new Set(years).size !== years.length;
};

const getProofFiles = () => selectedProofFiles;

const getFileKey = (file) => `${file.name}:${file.size}:${file.lastModified}`;

const getTotalProofBytes = (files = getProofFiles()) =>
  files.reduce((total, file) => total + file.size, 0);

const syncProofInputFiles = () => {
  const transfer = new DataTransfer();
  selectedProofFiles.forEach((file) => transfer.items.add(file));
  proofFilesInput.files = transfer.files;
};

const addProofFiles = (files) => {
  const existingKeys = new Set(selectedProofFiles.map(getFileKey));
  const acceptedFiles = [...selectedProofFiles];
  const rejectedFiles = [];

  Array.from(files ?? []).forEach((file) => {
    const key = getFileKey(file);

    if (existingKeys.has(key)) {
      return;
    }

    if (getTotalProofBytes(acceptedFiles) + file.size > MAX_TOTAL_PROOF_BYTES) {
      rejectedFiles.push(file.name);
      return;
    }

    acceptedFiles.push(file);
    existingKeys.add(key);
  });

  selectedProofFiles = acceptedFiles;
  syncProofInputFiles();
  renderSelectedFiles();

  if (rejectedFiles.length) {
    setStatus(
      `Upload limit is 20 MB total. Some files were not added: ${rejectedFiles.join(", ")}`,
      "error",
    );
  }
};

const removeProofFile = (fileKey) => {
  selectedProofFiles = selectedProofFiles.filter((file) => getFileKey(file) !== fileKey);
  syncProofInputFiles();
  renderSelectedFiles();
};

const sanitizeFileName = (fileName) => {
  const cleaned = fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);

  return cleaned || "proof-file";
};

const formatFileSize = (bytes) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const renderSelectedFiles = () => {
  while (fileList.firstChild) {
    fileList.removeChild(fileList.firstChild);
  }

  getProofFiles().forEach((file) => {
    const item = document.createElement("li");
    const details = document.createElement("div");
    const name = document.createElement("strong");
    const meta = document.createElement("span");
    const removeButton = document.createElement("button");

    name.textContent = file.name;
    meta.textContent = `${formatFileSize(file.size)}${file.type ? ` • ${file.type}` : ""}`;
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => removeProofFile(getFileKey(file)));
    details.append(name, meta);
    item.append(details, removeButton);
    fileList.appendChild(item);
  });

  if (getProofFiles().length) {
    const summary = document.createElement("li");
    summary.className = "file-list-summary";
    summary.textContent = `Total selected: ${formatFileSize(getTotalProofBytes())} of 20 MB`;
    fileList.appendChild(summary);
  }
};

const uploadProofFiles = async (submissionId) => {
  const files = getProofFiles();

  if (!files.length) {
    throw new Error("Upload at least one proof document.");
  }

  const uploadedFiles = [];

  for (const [index, file] of files.entries()) {
    const safeName = sanitizeFileName(file.name);
    const path = `${submissionId}/${String(index + 1).padStart(2, "0")}-${Date.now()}-${safeName}`;
    const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, {
      cacheControl: "3600",
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

    if (error) {
      throw new Error(error.message);
    }

    uploadedFiles.push({
      bucket: PROOF_BUCKET,
      path,
      original_name: file.name,
      size_bytes: file.size,
      mime_type: file.type || null,
      uploaded_at: new Date().toISOString(),
    });
  }

  return uploadedFiles;
};

const buildPayload = async (deviceWindow = createDeviceSubmissionWindow()) => {
  const [deviceDetails, publicIpDetails] = await Promise.all([
    getDeviceDetails(),
    getPublicIpDetails(),
  ]);
  const deviceFingerprint = await getDeviceFingerprint(deviceDetails);
  const submissionWindow = createDeviceSubmissionWindow(
    deviceFingerprint,
    deviceWindow.device_id,
  );

  return {
    id: crypto.randomUUID(),
    full_name: getValue("fullName", 120),
    phone_number: getValue("phone", 20),
    email: getValue("email", 160) || null,
    amount_invested: Number(getValue("amountInvested")),
    resident_state: getValue("state", 80),
    resident_district: getValue("district", 120),
    tds_details: getTdsDetails(),
    case_filed: caseFiled.checked,
    case_types: caseFiled.checked ? getSelectedCaseTypes() : [],
    case_details: caseFiled.checked ? getValue("caseDetails", 1000) || null : null,
    proof_link: getValue("proofLink", 500) || null,
    proof_files: [],
    ip_address: publicIpDetails?.ip ?? null,
    ...submissionWindow,
    device_details: {
      ...deviceDetails,
      public_ip_lookup: publicIpDetails,
      client_submission_limit: {
        ...submissionWindow,
        max_submissions_per_device_per_day: DAILY_SUBMISSION_LIMIT,
      },
    },
    entered_at: new Date().toISOString(),
  };
};

const buildDatabasePayload = (payload, includeCaseColumns = true) => {
  const databasePayload = { ...payload };

  databasePayload.device_details = {
    ...payload.device_details,
    form_case_details: {
      case_filed: payload.case_filed,
      case_types: payload.case_types,
      case_details: payload.case_details,
    },
  };

  if (!includeCaseColumns) {
    delete databasePayload.case_types;
    delete databasePayload.case_details;
  }

  return databasePayload;
};

const saveWithEdgeFunction = async (payload) => {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/collect-investor`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(buildDatabasePayload(payload)),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Edge Function failed with ${response.status}.`);
  }
};

const saveDirectly = async (payload) => {
  const { error } = await supabase
    .from("investor_submissions")
    .insert(buildDatabasePayload(payload));

  if (
    error?.message?.includes("case_types") ||
    error?.message?.includes("case_details")
  ) {
    const { error: legacyError } = await supabase
      .from("investor_submissions")
      .insert(buildDatabasePayload(payload, false));

    if (legacyError) {
      throw new Error(legacyError.message);
    }

    return;
  }

  if (error) {
    throw new Error(error.message);
  }
};

const saveProofFileRows = async (payload) => {
  const fileRows = payload.proof_files.map((file) => ({
    submission_id: payload.id,
    bucket_id: file.bucket,
    object_path: file.path,
    original_name: file.original_name,
    mime_type: file.mime_type,
    size_bytes: file.size_bytes,
    uploaded_at: file.uploaded_at,
  }));

  if (!fileRows.length) {
    return;
  }

  const { error } = await supabase.from("investor_proof_files").insert(fileRows);

  if (error) {
    throw new Error(error.message);
  }
};

const getFriendlySaveError = (error) => {
  const message = error?.message || "Unknown Supabase error.";

  if (
    message.includes("Could not find the table") ||
    message.includes("schema cache") ||
    message.includes("investor_submissions") ||
    message.includes("investor_proof_files") ||
    message.includes("resident_state") ||
    message.includes("resident_district") ||
    message.includes("tds_details") ||
    message.includes("proof_files") ||
    message.includes("proof_link") ||
    message.includes("device_id") ||
    message.includes("device_fingerprint") ||
    message.includes("device_submission_day") ||
    message.includes("device_daily_key")
  ) {
    return "Database setup incomplete: run the updated SETUP_SUPABASE.sql in the Supabase SQL Editor so submissions and uploaded file records can be saved.";
  }

  if (
    message.includes("Daily submission limit") ||
    message.includes("daily submission limit")
  ) {
    return "Daily limit reached: one device can submit only 3 entries per day. Please try again tomorrow.";
  }

  if (
    message.includes("Total proof upload size") ||
    message.includes("20 MB")
  ) {
    return "Upload limit is 20 MB total per submission. Remove a few files or add large proofs as a Google Drive link.";
  }

  if (message.includes("Bucket not found") || message.includes(PROOF_BUCKET)) {
    return "Proof upload setup incomplete: run the updated SETUP_SUPABASE.sql so Supabase creates the private investor-proofs bucket and upload policy.";
  }

  if (message.includes("row-level security") || message.includes("policy")) {
    return "Database policy issue: run supabase/schema.sql again so public form submissions are allowed but public reads stay blocked.";
  }

  return `Could not save the details. Supabase error: ${message}`;
};

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const formatAmount = (value) => currencyFormatter.format(Number(value || 0));

const setLedgerStatus = (message) => {
  ledgerStatus.textContent = message;
};

const clearLedgerBody = () => {
  while (ledgerBody.firstChild) {
    ledgerBody.removeChild(ledgerBody.firstChild);
  }
};

const appendEmptyLedgerRow = (message) => {
  clearLedgerBody();
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.textContent = message;
  row.appendChild(cell);
  ledgerBody.appendChild(row);
};

const renderLedgerRows = (rows) => {
  clearLedgerBody();

  if (!rows.length) {
    appendEmptyLedgerRow("No matching public records yet.");
    return;
  }

  rows.forEach((entry) => {
    const row = document.createElement("tr");
    const contactCell = document.createElement("td");
    const amountCell = document.createElement("td");
    const caseCell = document.createElement("td");
    const dateCell = document.createElement("td");
    const casePill = document.createElement("span");

    contactCell.textContent = entry.masked_contact || "Masked investor";
    amountCell.textContent = formatAmount(entry.amount_invested);
    amountCell.className = "amount-cell";
    casePill.textContent =
      entry.case_status || (entry.case_filed ? "Yes (Active)" : "No / Pending");
    casePill.className = `case-pill ${entry.case_filed ? "yes" : "no"}`;
    caseCell.appendChild(casePill);
    dateCell.textContent = entry.created_at
      ? dateFormatter.format(new Date(entry.created_at))
      : "-";

    row.append(contactCell, amountCell, caseCell, dateCell);
    ledgerBody.appendChild(row);
  });
};

const applyLedgerFilter = () => {
  const query = ledgerSearch.value.trim().toLowerCase();

  if (!query) {
    renderLedgerRows(publicLedgerRows);
    return;
  }

  renderLedgerRows(
    publicLedgerRows.filter((entry) =>
      [entry.masked_contact, entry.case_status, entry.amount_invested]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    ),
  );
};

const loadLedger = async () => {
  setLedgerStatus("Syncing public ledger...");

  const [{ data: summary, error: summaryError }, { data: rows, error: rowsError }] =
    await Promise.all([
      supabase.rpc("get_public_investor_summary"),
      supabase.rpc("get_public_investor_ledger", { row_limit: 100 }),
    ]);

  if (summaryError || rowsError) {
    console.error(summaryError, rowsError);
    totalAmount.textContent = "₹0";
    totalVictims.textContent = "0";
    totalCases.textContent = "0";
    publicLedgerRows = [];
    appendEmptyLedgerRow("Run the updated SETUP_SUPABASE.sql to enable the public ledger.");
    setLedgerStatus("Public ledger setup is pending in Supabase.");
    return;
  }

  const summaryRow = summary?.[0] ?? {};
  publicLedgerRows = rows ?? [];
  totalAmount.textContent = formatAmount(summaryRow.total_amount);
  totalVictims.textContent = Number(summaryRow.total_victims || 0).toLocaleString("en-IN");
  totalCases.textContent = Number(summaryRow.cases_filed || 0).toLocaleString("en-IN");
  applyLedgerFilter();
  setLedgerStatus(
    publicLedgerRows.length
      ? "Public ledger synced. Private identity fields remain hidden."
      : "No public ledger records yet.",
  );
};

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  if (hasDuplicateTdsYears()) {
    setStatus("Each TDS financial year should be added only once.", "error");
    return;
  }

  if (!getProofFiles().length) {
    setStatus("Upload at least one proof document before submitting.", "error");
    return;
  }

  if (getTotalProofBytes() > MAX_TOTAL_PROOF_BYTES) {
    setStatus("Upload limit is 20 MB total per submission. Remove a few files and try again.", "error");
    return;
  }

  const deviceWindow = createDeviceSubmissionWindow();

  if (getLocalSubmissionCount(deviceWindow.device_daily_key) >= DAILY_SUBMISSION_LIMIT) {
    setStatus(
      "Daily limit reached: one device can submit only 3 entries per day. Please try again tomorrow.",
      "error",
    );
    return;
  }

  submitButton.disabled = true;
  setStatus("Collecting IP and browser details...");
  let payload;

  try {
    payload = await buildPayload(deviceWindow);
    setStatus("Uploading proof documents...");
    payload.proof_files = await uploadProofFiles(payload.id);
    setStatus("Saving your details...");
    await saveDirectly(payload);
    setStatus("Saving uploaded file records...");
    await saveProofFileRows(payload);
    recordSuccessfulDeviceSubmission(payload.device_daily_key);
    form.reset();
    populateDistricts();
    resetTdsRows();
    selectedProofFiles = [];
    syncProofInputFiles();
    renderSelectedFiles();
    setStatus("Your details have been saved successfully.", "success");
    await loadLedger();
  } catch (edgeError) {
    console.error(edgeError);
    setStatus(getFriendlySaveError(edgeError), "error");
  } finally {
    submitButton.disabled = false;
  }
});

caseFiled.addEventListener("change", () => {
  caseDetailsPanel.hidden = !caseFiled.checked;

  if (!caseFiled.checked) {
    document
      .querySelectorAll('input[name="caseType"]')
      .forEach((input) => {
        input.checked = false;
      });
    document.querySelector("#caseDetails").value = "";
  }
});

ledgerSearch.addEventListener("input", applyLedgerFilter);
refreshLedger.addEventListener("click", loadLedger);
proofFilesInput.addEventListener("change", () => {
  addProofFiles(proofFilesInput.files);
});

addTdsRowButton.addEventListener("click", createTdsRow);
stateSelect.addEventListener("change", populateDistricts);

["dragenter", "dragover"].forEach((eventName) => {
  proofDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    proofDropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  proofDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    proofDropZone.classList.remove("dragging");
  });
});

proofDropZone.addEventListener("drop", (event) => {
  addProofFiles(event.dataTransfer.files);
});

resetTdsRows();
populateDistricts();
loadLedger();
