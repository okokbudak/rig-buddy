// Prints what the media service reports, through the agent (the service itself,
// 127.0.0.1:62844, only accepts the agent: it needs RigBuddy.exe's per-run key).
const res = await fetch('http://127.0.0.1:62843/media');
const m = await res.json();
console.log(JSON.stringify(m, null, 1).slice(0, 1500));
if (m.current?.artKey) console.log(`art: http://127.0.0.1:62843/media/art/${m.current.artKey}`);
