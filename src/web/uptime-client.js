// On-demand uptime client (the inline browser script).
//
// The page renders instantly with the build-time status, then — at most once
// per TTL of ACTUAL viewing — refreshes the dots from the uptime function.
// `shouldRefresh` is the single gate that keeps serverless invocations bounded;
// test/uptime-client.test.js asserts it (and the simulation below) so a
// regression can't quietly blow the serverless budget. The gate is embedded
// verbatim into the shipped script via .toString() — the tested code IS the
// shipped code.

export const UPTIME_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Pure + self-contained (no closure references) so it can be unit-tested AND
// embedded into the inline script. Returns true = fetch the function; false =
// use the cached status and make NO network call.
export function shouldRefresh(cache, nowMs, ttlMs) {
  if (!cache || typeof cache.checkedAtMs !== "number" || !Number.isFinite(cache.checkedAtMs)) return true;
  return nowMs - cache.checkedAtMs >= ttlMs;
}

/**
 * The inline <script> body injected into index.html / sites.html. It embeds
 * `shouldRefresh` verbatim so the budget gate that ships is the one we test.
 */
export function uptimeClientScript({
  ttlMs = UPTIME_TTL_MS,
  endpoint = "/.netlify/functions/uptime",
  storageKey = "filecap-uptime",
} = {}) {
  return `(function(){
  var TTL=${ttlMs},EP=${JSON.stringify(endpoint)},KEY=${JSON.stringify(storageKey)};
  ${shouldRefresh.toString()}
  function readCache(){try{return JSON.parse(localStorage.getItem(KEY));}catch(e){return null;}}
  function writeCache(c){try{localStorage.setItem(KEY,JSON.stringify(c));}catch(e){}}
  function fmtChecked(ms){try{return "checked "+new Date(ms).toLocaleString("en-US",{timeZone:"America/Chicago",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});}catch(e){return "";}}
  function apply(data){
    if(!data||!data.sites)return;
    var when=data.checkedAtMs?fmtChecked(data.checkedAtMs):"";
    var nodes=document.querySelectorAll("[data-uptime-key]");
    for(var i=0;i<nodes.length;i++){
      var el=nodes[i],st=data.sites[el.getAttribute("data-uptime-key")];
      if(st!=="live"&&st!=="down")continue;
      el.classList.remove("status-live","status-down");
      el.classList.add(st==="live"?"status-live":"status-down");
      var lab=el.querySelector(".status-label");
      if(lab)lab.textContent=(st==="live"?"Site live":"Site unreachable");
      var chk=el.querySelector(".status-checked");
      if(chk&&when)chk.textContent=when;
      el.setAttribute("title",st==="live"?"This site responded at the last check":"This site was unreachable at the last check");
    }
  }
  var cache=readCache();
  if(cache)apply(cache);
  if(!shouldRefresh(cache,Date.now(),TTL))return;
  fetch(EP,{headers:{accept:"application/json"}}).then(function(r){return r&&r.ok?r.json():null;}).then(function(data){
    if(!data||!data.sites)return;
    data.checkedAtMs=Date.now();
    writeCache(data);
    apply(data);
  }).catch(function(){});
})();`;
}
