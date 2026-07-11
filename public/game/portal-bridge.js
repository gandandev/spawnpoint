(function () {
  "use strict";
  var query = new URLSearchParams(window.location.search);
  var ticket = query.get("ticket");
  var account = query.get("account") || "player";
  var options = window.eaglercraftXOpts || window.eaglercraftXOptsHints;

  if (!options || !ticket) {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.innerHTML = "<main style='display:grid;place-items:center;height:100%;background:#111411;color:#d8ddcf;font:14px monospace'>open this client from spawnpoint after logging in</main>";
    });
    return;
  }

  var websocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  var gateway = websocketProtocol + "//" + window.location.host + "/gateway?ticket=" + encodeURIComponent(ticket);
  options.servers = [{ addr: gateway, name: "spawnpoint", hideAddress: true }];
  options.joinServer = gateway;
  options.relays = [];
  options.checkRelaysForUpdates = false;
  options.localStorageNamespace = "_spawnpoint_" + account.toLowerCase();
  options.enableDownloadOfflineButton = false;
  options.openDebugConsoleOnLaunch = false;
  options.allowUpdateSvc = false;
  document.title = "spawnpoint, " + account;
  history.replaceState(null, "", window.location.pathname);
})();

