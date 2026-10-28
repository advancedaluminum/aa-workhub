/**
 * WorkHub invoice inbox (Google Apps Script)
 *
 * Sends vendor invoices from Gmail to WorkHub. Every 10 minutes it looks at
 * emails with the Gmail label "WorkHub Invoices" and sends each PDF or photo
 * attachment to WorkHub, which reads it and files it on the right job.
 *
 * Setup (once, signed in to the Google account that receives the invoices):
 *   1. script.google.com -> New project. Name it "WorkHub invoice inbox".
 *      Replace everything in Code.gs with this file and click Save.
 *   2. Project Settings (gear) -> Script Properties -> add two properties:
 *        INBOX_URL     https://ehamiqbdtzpjnxbjkzlr.supabase.co/functions/v1/invoice-inbox
 *        INBOX_SECRET  the same long password you saved as INBOX_SECRET in Supabase
 *   3. Back in the editor, choose the function "setup" and click Run.
 *      Approve the Gmail permissions Google asks for.
 * After that it runs by itself. Choose "sendInvoices" and click Run any time
 * to send right away.
 *
 * The password lives only in Script Properties, never in this code.
 */

var LABEL = "WorkHub Invoices";        // the Gmail filter puts this label on vendor invoices
var SENT_LABEL = "WorkHub Invoices/Sent"; // added after an email's files reach WorkHub
var LOOK_BACK_DAYS = 14;               // only emails received in the last two weeks
var MIN_IMAGE_BYTES = 30 * 1024;       // skip small images such as email signatures and logos

function setup() {
  getOrCreateLabel_(LABEL);
  getOrCreateLabel_(SENT_LABEL);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "sendInvoices") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendInvoices").timeBased().everyMinutes(10).create();
  sendInvoices();
}

function sendInvoices() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("INBOX_URL"), secret = props.getProperty("INBOX_SECRET");
  if (!url || !secret) throw new Error("Add INBOX_URL and INBOX_SECRET under Project Settings -> Script Properties.");

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return; // the last run is still going
  try {
    var done = loadDone_();
    var label = getOrCreateLabel_(LABEL), sent = getOrCreateLabel_(SENT_LABEL);
    var since = Date.now() - LOOK_BACK_DAYS * 864e5;
    var threads = label.getThreads(0, 50);
    threads.forEach(function (thread) {
      var allSent = true;
      thread.getMessages().forEach(function (msg) {
        if (msg.getDate().getTime() < since || done[msg.getId()]) return;
        var ok = true;
        msg.getAttachments({ includeInlineImages: false }).forEach(function (att) {
          var type = String(att.getContentType() || "").toLowerCase();
          var name = att.getName() || "invoice";
          var isPdf = type === "application/pdf" || /\.pdf$/i.test(name);
          var isImg = /^image\/(jpeg|jpg|png|webp)$/.test(type);
          if (!isPdf && !isImg) return;
          if (isImg && att.getSize() < MIN_IMAGE_BYTES) return;
          var res = UrlFetchApp.fetch(url, {
            method: "post",
            contentType: "application/json",
            headers: { "x-inbox-secret": secret },
            muteHttpExceptions: true,
            payload: JSON.stringify({
              messageId: msg.getId(),
              from: msg.getFrom(),
              subject: msg.getSubject(),
              receivedAt: msg.getDate().toISOString(),
              fileName: name,
              mimeType: isPdf ? "application/pdf" : type,
              data: Utilities.base64Encode(att.getBytes())
            })
          });
          if (res.getResponseCode() !== 200) {
            ok = false;
            console.warn("WorkHub didn't take " + name + " (" + res.getResponseCode() + "): " + res.getContentText().slice(0, 300));
          }
        });
        if (ok) done[msg.getId()] = Date.now(); else allSent = false;
      });
      if (allSent) thread.addLabel(sent);
    });
    saveDone_(done);
  } finally {
    lock.releaseLock();
  }
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
// Remembers which emails were already sent, for a month and a half.
function loadDone_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("DONE") || "{}"); } catch (e) { return {}; }
}
function saveDone_(done) {
  var cutoff = Date.now() - 45 * 864e5, keep = {};
  Object.keys(done).forEach(function (k) { if (done[k] > cutoff) keep[k] = done[k]; });
  PropertiesService.getScriptProperties().setProperty("DONE", JSON.stringify(keep));
}
