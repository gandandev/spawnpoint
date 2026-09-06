// Both upstream loading stages share the site's existing OG art and real boot progress.
export function brandLoadingScreen(html) {
  const start = html.indexOf('\t<div id="loading_screen"');
  const end = html.indexOf('\t<div id="game_frame"', start);
  if (start < 0 || end < 0) throw Error('Loading screen markup changed');
  html = html.slice(0, start) + `<div id="loading_screen" role="status" aria-label="게임 불러오는 중">
    <img id="spawnpoint_loading_logo" alt="">
    <div id="spawnpoint_loading_status"><div id="boot_status">게임 불러오는 중</div>
      <div id="spawnpoint_loading_track" role="progressbar" aria-label="게임 로딩" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="spawnpoint_loading_fill"></div></div>
      <a id="spawnpoint_loading_exit" href="/" target="_top">포털로 돌아가기</a>
    </div>
  </div>
  <script>
    (() => {
      const started = Date.now();
      const status = document.getElementById('boot_status');
      const exit = document.getElementById('spawnpoint_loading_exit');
      const timer = setInterval(() => {
        if (window.__loaded || window.__err) { clearInterval(timer); return; }
        const seconds = Math.floor((Date.now() - started) / 1000);
        status.textContent = (status.dataset.stage || '실행 환경을 준비하는 중') + ' · ' + seconds + '초' + (seconds >= 45 ? ' · 처음 실행은 더 걸릴 수 있어요' : '');
        if (seconds >= 45) exit.style.display = 'inline-block';
      }, 1000);
      const showCrash = window.__eaglerShowShellCrash;
      window.__eaglerShowShellCrash = error => {
        clearInterval(timer);
        document.getElementById('loading_screen')?.remove();
        showCrash(error);
        const panel = document.querySelector('._eaglercraftX_crash_element');
        if (panel) panel.appendChild(exit);
        exit.style.display = 'block';
      };
      const host = location.hostname.toLowerCase();
      const key = host === 'xn--o79a769b.xn--hk3b17f.xn--3e0b707e' || host === '예게.서버.한국' ? 'yege'
        : host === 'xn--9k3b21rt2f.xn--hk3b17f.xn--3e0b707e' || host === '베이컨.서버.한국' ? 'bacon' : 'spawnpoint';
      document.getElementById('loading_screen').style.setProperty('--loading-image', 'url(/loading/' + key + '-background.jpg)');
      const logo = document.getElementById('spawnpoint_loading_logo');
      logo.src = '/loading/' + key + '-logo.png';
      logo.alt = key === 'yege' ? '예게.서버.한국' : key === 'bacon' ? '베이컨.서버.한국' : 'spawnpoint';
    })();
  </script>
` + html.slice(end);
  const statusAnchor = 'var st = document.getElementById("boot_status");';
  if (html.split(statusAnchor).length !== 2) throw Error('Boot progress hook changed');
  html = html.replace(statusAnchor, `var progress = Math.max(0, Math.min(100, Number(pct) || 0));
    var track = document.getElementById('spawnpoint_loading_track');
    if (track) { progress = Math.max(Number(track.getAttribute('aria-valuenow')), progress); track.setAttribute('aria-valuenow', progress); }
    var fill = document.getElementById('spawnpoint_loading_fill');
    if (fill) fill.style.width = progress + '%';
    ${statusAnchor}
    if (st) st.dataset.stage = text;`);
  const ready = 'window.__eaglerGameReady === true';
  if (html.split(ready).length !== 2) throw Error('Boot completion hook changed');
  html = html.replace(ready, `(window.__eaglerWorldReady === true || (window.__eaglerGameReady === true && /(?:DisconnectedScreen|TitleScreen|JoinMultiplayerScreen)$/.test(window.__spawnpoint262?.screen || '')))`);
  return html.replace('</head>', `<style>
    #loading_screen,#loading_screen.minecraft-stage{position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;background-color:#17221b!important;background-size:cover!important;background-position:center!important;user-select:none;overflow:hidden}
    #loading_screen::before{content:"";position:absolute;inset:-8px;background:var(--loading-image) center/cover;filter:blur(4px)}
    #spawnpoint_loading_logo{width:min(48vw,550px);max-height:16vh;object-fit:contain;position:relative}
    #spawnpoint_loading_status{position:absolute;bottom:max(28px,6vh);left:50%;transform:translateX(-50%);width:min(560px,calc(100% - 48px));color:white;text-shadow:2px 2px #000;font-size:clamp(12px,2.4vw,18px)}
    #loading_screen #boot_status{position:static!important;display:block!important;color:white!important;margin:0 0 7px!important;font-size:inherit!important;text-align:left!important}
    #spawnpoint_loading_exit{display:none;color:inherit;margin-top:16px;font-size:14px;text-decoration:underline}
    #spawnpoint_loading_track{height:22px;border:2px solid white;padding:3px;box-sizing:border-box;background:#0006;box-shadow:0 1px 4px #0008}
    #spawnpoint_loading_fill{height:100%;width:0;background:white}
  </style></head>`);
}
