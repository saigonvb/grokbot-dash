// A dashboard link, …/grokbot-wallpaper/#gbw-… (maybe with &ntfy=… after it), opens the 3D office. The hash never
// leaves the browser, so the topic is not sent to any server.
function toOffice() { if (/^#gbw-[\w-]+(&|$)/.test(location.hash)) location.replace('office/' + location.hash); }
toOffice();
addEventListener('hashchange', toOffice);                  // the link pasted into a tab that already shows this page
