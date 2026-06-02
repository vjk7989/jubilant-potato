import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

let publicLedgerRows = [];

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

const getValue = (id) => document.querySelector(`#${id}`).value.trim();

const getSelectedCaseTypes = () =>
  Array.from(document.querySelectorAll('input[name="caseType"]:checked')).map(
    (input) => input.value,
  );

const buildPayload = async () => {
  const [deviceDetails, publicIpDetails] = await Promise.all([
    getDeviceDetails(),
    getPublicIpDetails(),
  ]);

  return {
    full_name: getValue("fullName"),
    phone_number: getValue("phone"),
    email: getValue("email") || null,
    amount_invested: Number(getValue("amountInvested")),
    case_filed: caseFiled.checked,
    case_types: caseFiled.checked ? getSelectedCaseTypes() : [],
    case_details: caseFiled.checked ? getValue("caseDetails") || null : null,
    proof_link: getValue("proofLink"),
    ip_address: publicIpDetails?.ip ?? null,
    device_details: {
      ...deviceDetails,
      public_ip_lookup: publicIpDetails,
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

const getFriendlySaveError = (error) => {
  const message = error?.message || "Unknown Supabase error.";

  if (
    message.includes("Could not find the table") ||
    message.includes("schema cache") ||
    message.includes("investor_submissions")
  ) {
    return "Database setup incomplete: create the investor_submissions table by running supabase/schema.sql in the Supabase SQL Editor.";
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

  submitButton.disabled = true;
  setStatus("Collecting IP and browser details...");
  let payload;

  try {
    payload = await buildPayload();
    setStatus("Saving your details...");
    await saveWithEdgeFunction(payload);
    form.reset();
    setStatus("Your details have been saved successfully.", "success");
    await loadLedger();
  } catch (edgeError) {
    try {
      await saveDirectly(payload);
      form.reset();
      setStatus("Your details have been saved successfully.", "success");
      await loadLedger();
    } catch (directError) {
      console.error(edgeError, directError);
      setStatus(getFriendlySaveError(directError), "error");
    }
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

loadLedger();
