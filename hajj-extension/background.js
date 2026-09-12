const LOGIN_URL = "https://hajjregister.com/";
const PILGRIMS_URL = "https://hajjregister.com/Pilgrim/Index";

const LOGIN_TIMEOUT_MS = 20000;
const SEARCH_TIMEOUT_MS = 15000;
const RECEIPT_PRINT_TIMEOUT_MS = 25000;
const FAMILY_PRINT_TIMEOUT_MS = 45000;
const POLL_STEP_MS = 300;
const REPORT_FRAME_ID = "stiPrintReportFrame";

const XPATH_LOGIN_EMAIL = "/html/body/div[2]/div[2]/form/div[2]/div[2]/input";
const XPATH_LOGIN_PASSWORD = "/html/body/div[2]/div[2]/form/div[3]/div[2]/input";
const XPATH_LOGIN_SUBMIT = "/html/body/div[2]/div[2]/form/button";
const XPATH_SEARCH_BOX = "/html/body/div[3]/div[2]/div[3]/div/div[2]/div/div/div[3]/label/input";
const XPATH_ROW_NAME = "/html/body/div[3]/div[2]/div[3]/div/div[2]/div/div/div[5]/table/tbody/tr[1]/td[2]";
const XPATH_STATUS = "/html/body/div[3]/div[2]/div[3]/div/div[2]/div/div/div[5]/table/tbody/tr[1]/td[8]/span";
const XPATH_ACTIONS_CELL = "/html/body/div[3]/div[2]/div[3]/div/div[2]/div/div/div[5]/table/tbody/tr[1]/td[12]";

const XPATH_USER_MENU = "/html/body/div[2]/div/ul[2]/li/a";
const XPATH_LOGOUT_LINK = "/html/body/div[2]/div/ul[2]/li/div/a[2]";
const XPATH_LOGOUT_CONFIRM = "/html/body/div[13]/div/div[3]/button[1]";

const RECEIPT_LINK_TEXT = "طباعة بطاقة التسجيل";
const FAMILY_LINK_TEXT = "طباعة الطلب العائلي";

let jobRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cdp(tabId, method, params = {}) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function evalInPage(tabId, expression) {
  const result = await cdp(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      "خطأ أثناء تنفيذ جافاسكريبت داخل الصفحة: " +
        (result.exceptionDetails.text || JSON.stringify(result.exceptionDetails))
    );
  }
  return result.result ? result.result.value : undefined;
}

async function waitForPageLoad(tabId, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await evalInPage(tabId, "document.readyState").catch(() => null);
    if (ready === "complete") return true;
    await sleep(200);
  }
  return false;
}

const PRINT_HOOK_SOURCE = `
(function () {
  try {
    window.print = function () {
      try {
        (window.top || window).__printReady = true;
      } catch (e) {}
    };
  } catch (e) {}
})();
`;

async function armPrintInterception(tabId) {
  await cdp(tabId, "Page.addScriptToEvaluateOnNewDocument", { source: PRINT_HOOK_SOURCE });
}

const PAGE_HELPERS_SRC = `
(function () {
  function byXPath(xpath, root) {
    const r = document.evaluate(xpath, root || document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
    return r.singleNodeValue;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function pressEnter(el) {
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  window.__hajjTool = {
    fillLogin: function (emailXPath, passXPath, submitXPath, email, password) {
      const emailEl = byXPath(emailXPath);
      const passEl = byXPath(passXPath);
      const submitEl = byXPath(submitXPath);
      if (!emailEl || !passEl || !submitEl) return false;
      setNativeValue(emailEl, email);
      setNativeValue(passEl, password);
      submitEl.click();
      return true;
    },

    searchPerson: function (searchXPath, name) {
      const box = byXPath(searchXPath);
      if (!box) return false;
      setNativeValue(box, name);
      pressEnter(box);
      return true;
    },

    getSearchState: function (actionsCellXPath, statusXPath, rowNameXPath) {
      const actionsCell = byXPath(actionsCellXPath);
      const statusEl = byXPath(statusXPath);
      const nameEl = byXPath(rowNameXPath);
      return {
        found: !!actionsCell,
        rowName: nameEl ? nameEl.textContent.trim() : "",
        status: statusEl ? statusEl.textContent.trim() : "",
      };
    },

    clickByXPath: function (xpath) {
      const el = byXPath(xpath);
      if (!el) return false;
      el.click();
      return true;
    },

    elementExists: function (xpath) {
      return !!byXPath(xpath);
    },

    clickActionByText: function (actionsCellXPath, linkText) {
      const cell = byXPath(actionsCellXPath);
      if (!cell) return false;
      const links = Array.from(cell.querySelectorAll("a"));
      const link = links.find(function (a) {
        return a.textContent.trim() === linkText;
      });
      if (!link) return false;
      link.click();
      return true;
    },

    extractReportHtml: function (frameId) {
      const iframe = document.getElementById(frameId);
      if (!iframe || !iframe.contentDocument) return null;
      return iframe.contentDocument.documentElement.outerHTML;
    },
  };

  return true;
})();
`;

async function ensureHelpersInjected(tabId) {
  const has = await evalInPage(tabId, "typeof window.__hajjTool !== 'undefined'").catch(() => false);
  if (!has) {
    await evalInPage(tabId, PAGE_HELPERS_SRC);
  }
}

async function gotoPilgrimsList(tabId) {
  await cdp(tabId, "Page.navigate", { url: PILGRIMS_URL });
  await waitForPageLoad(tabId, 20000);
  await sleep(500);
  await ensureHelpersInjected(tabId);
}

async function logoutIfNeeded(tabId) {
  await cdp(tabId, "Page.navigate", { url: PILGRIMS_URL });
  await waitForPageLoad(tabId, 20000);
  await sleep(300);
  await ensureHelpersInjected(tabId).catch(() => {});

  const alreadyLoggedIn = await evalInPage(
    tabId,
    `window.__hajjTool.elementExists(${JSON.stringify(XPATH_SEARCH_BOX)})`
  ).catch(() => false);

  if (!alreadyLoggedIn) return;

  await evalInPage(tabId, `window.__hajjTool.clickByXPath(${JSON.stringify(XPATH_USER_MENU)})`).catch(() => {});
  await sleep(500);
  await evalInPage(tabId, `window.__hajjTool.clickByXPath(${JSON.stringify(XPATH_LOGOUT_LINK)})`).catch(() => {});
  await sleep(500);
  await evalInPage(tabId, `window.__hajjTool.clickByXPath(${JSON.stringify(XPATH_LOGOUT_CONFIRM)})`).catch(() => {});
  await sleep(1000);
}

async function login(tabId, email, password) {
  await logoutIfNeeded(tabId);

  await cdp(tabId, "Page.navigate", { url: LOGIN_URL });
  await waitForPageLoad(tabId, 20000);
  await ensureHelpersInjected(tabId);

  const filled = await evalInPage(
    tabId,
    `window.__hajjTool.fillLogin(${JSON.stringify(XPATH_LOGIN_EMAIL)}, ${JSON.stringify(
      XPATH_LOGIN_PASSWORD
    )}, ${JSON.stringify(XPATH_LOGIN_SUBMIT)}, ${JSON.stringify(email)}, ${JSON.stringify(password)})`
  );
  if (!filled) {
    throw new Error("تعذّر العثور على نموذج تسجيل الدخول — يُرجى التحقق من الموقع.");
  }

  const start = Date.now();
  while (Date.now() - start < LOGIN_TIMEOUT_MS) {
    await sleep(500);
    const url = await evalInPage(tabId, "location.href").catch(() => "");
    if (url && url !== LOGIN_URL && !url.includes("/Account/Login")) {
      await gotoPilgrimsList(tabId);
      return true;
    }
  }
  throw new Error("فشل تسجيل الدخول — يُرجى التحقق من البريد الإلكتروني وكلمة المرور.");
}

async function searchPerson(tabId, name) {
  await gotoPilgrimsList(tabId);

  const ok = await evalInPage(
    tabId,
    `window.__hajjTool.searchPerson(${JSON.stringify(XPATH_SEARCH_BOX)}, ${JSON.stringify(name)})`
  );
  if (!ok) {
    throw new Error("لم يظهر مربع البحث");
  }

  const normalize = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const targetName = normalize(name);

  const start = Date.now();
  while (Date.now() - start < SEARCH_TIMEOUT_MS) {
    await sleep(POLL_STEP_MS);
    const state = await evalInPage(
      tabId,
      `window.__hajjTool.getSearchState(${JSON.stringify(XPATH_ACTIONS_CELL)}, ${JSON.stringify(
        XPATH_STATUS
      )}, ${JSON.stringify(XPATH_ROW_NAME)})`
    ).catch(() => null);
    if (state && state.found && normalize(state.rowName) === targetName) {
      return state.status;
    }
  }

  throw new Error(`لم تتحدّث نتيجة البحث للاسم "${name}" خلال المهلة المحددة (أو لم يُعثر عليه)`);
}

async function captureHtmlAsPdf(html) {
  const tempTab = await chrome.tabs.create({ url: "about:blank", active: false });
  const tempTabId = tempTab.id;
  try {
    await chrome.debugger.attach({ tabId: tempTabId }, "1.3");
    await cdp(tempTabId, "Page.enable");
    await evalInPage(
      tempTabId,
      `document.open(); document.write(${JSON.stringify(html)}); document.close();`
    );
    await waitForPageLoad(tempTabId, 8000);
    const pdf = await cdp(tempTabId, "Page.printToPDF", {
      printBackground: true,
      preferCSSPageSize: true,
    });
    return pdf.data;
  } finally {
    try {
      await chrome.debugger.detach({ tabId: tempTabId });
    } catch (e) {}
    try {
      await chrome.tabs.remove(tempTabId);
    } catch (e) {}
  }
}

async function downloadOneFile(tabId, linkText, timeoutMs) {
  await evalInPage(tabId, "window.__printReady = false");

  const clicked = await evalInPage(
    tabId,
    `window.__hajjTool.clickActionByText(${JSON.stringify(XPATH_ACTIONS_CELL)}, ${JSON.stringify(linkText)})`
  );
  if (!clicked) {
    throw new Error(`الرابط "${linkText}" غير موجود لهذا الشخص`);
  }

  const start = Date.now();
  let ready = false;
  while (Date.now() - start < timeoutMs) {
    await sleep(POLL_STEP_MS);
    ready = await evalInPage(tabId, "window.__printReady === true").catch(() => false);
    if (ready) break;
  }

  if (!ready) {
    await gotoPilgrimsList(tabId);
    throw new Error("لم يُجهَّز الملف خلال المهلة المحددة");
  }

  const html = await evalInPage(
    tabId,
    `window.__hajjTool.extractReportHtml(${JSON.stringify(REPORT_FRAME_ID)})`
  ).catch(() => null);
  if (!html) {
    await gotoPilgrimsList(tabId);
    throw new Error("تعذّر العثور على محتوى التقرير الجاهز للطباعة");
  }

  return captureHtmlAsPdf(html);
}

async function runJob(job, port) {
  const { email, password, people } = job;
  const total = people.length;
  let done = 0;

  const reportRows = [];
  const downloadedFamilyFiles = new Set();

  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const tabId = tab.id;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await cdp(tabId, "Page.enable");
    await armPrintInterception(tabId);

    await login(tabId, email, password);

    for (const person of people) {
      const name = String(person.name || "").trim();
      const familyNo = String(person.familyNo || "").trim();
      if (!name) continue;

      let status = "";
      let receiptStatus = "لم يتم التحميل";
      let familyStatus = "لم يتم التحميل";

      try {
        status = await searchPerson(tabId, name);
      } catch (e) {
        status = "لم يُعثر على الشخص";
      }

      if (status === "منقول") {
        if (familyNo && downloadedFamilyFiles.has(familyNo)) {
          familyStatus = "تم تحميله مسبقًا لعضو آخر من العائلة نفسها";
        } else {
          try {
            const base64 = await downloadOneFile(tabId, FAMILY_LINK_TEXT, FAMILY_PRINT_TIMEOUT_MS);
            const base = familyNo || name;
            const filename = `${base}_بطاقة الطلب العائلي.pdf`;
            port.postMessage({ type: "file", filename, base64 });
            familyStatus = "تم";
            if (familyNo) downloadedFamilyFiles.add(familyNo);
          } catch (e) {
            familyStatus = "لم يتم التحميل";
          }
          try {
            await searchPerson(tabId, name);
          } catch (e) {}
        }

        try {
          const base64 = await downloadOneFile(tabId, RECEIPT_LINK_TEXT, RECEIPT_PRINT_TIMEOUT_MS);
          const base = familyNo ? `${familyNo}_${name}` : name;
          const filename = `${base}_بطاقة تسجيل.pdf`;
          port.postMessage({ type: "file", filename, base64 });
          receiptStatus = "تم";
        } catch (e) {
          receiptStatus = "لم يتم التحميل";
        }
      }

      reportRows.push({
        name,
        familyNo,
        status: status || "",
        receiptStatus,
        familyStatus,
      });

      done += 1;
      port.postMessage({
        type: "progress",
        done,
        total,
        percent: Math.round((done / total) * 100),
        currentName: name,
      });
    }

    port.postMessage({ type: "done", report: reportRows });
  } catch (e) {
    port.postMessage({ type: "error", message: e && e.message ? e.message : String(e) });
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}
    try {
      await chrome.tabs.remove(tabId);
    } catch (e) {}
    jobRunning = false;
  }
}

chrome.runtime.onConnectExternal.addListener((port) => {
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === "ping") {
      port.postMessage({ type: "pong" });
      return;
    }

    if (msg && msg.type === "start") {
      if (jobRunning) {
        port.postMessage({ type: "error", message: "توجد مهمة تحميل قيد التنفيذ حاليًا، يُرجى الانتظار حتى تنتهي." });
        return;
      }
      jobRunning = true;
      runJob(msg, port);
    }
  });
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message && message.type === "ping") {
    sendResponse({ type: "pong" });
  }
  return true;
});
