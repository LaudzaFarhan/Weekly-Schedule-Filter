const fs = require('fs');
const html = fs.readFileSync('temp.html', 'utf8');

const tabs = [];
const oldRegex = /<li[^>]*id="sheet-button-(\d+)"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/g;
let match;
while ((match = oldRegex.exec(html)) !== null) {
  tabs.push({ gid: match[1], name: match[2].trim() });
}

if (tabs.length === 0) {
  const newRegex = /\{name:\s*"([^"]+)"[^}]+gid:\s*"(\d+)"/g;
  while ((match = newRegex.exec(html)) !== null) {
    tabs.push({ gid: match[2], name: match[1].trim() });
  }
}
console.log('Found tabs:', tabs);
