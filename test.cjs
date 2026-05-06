const fs = require('fs');
const url = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS2ZEndjqsEzgvblfHF44IPQmJQRVHo65zzOya727KEZ0HjtmhXNAmXgzDXTPtGt9q3A02RqG0EV-7d/pubhtml';
fetch('http://localhost:3001/proxy?url=' + encodeURIComponent(url))
  .then(r => r.text())
  .then(html => {
    fs.writeFileSync('temp.html', html);
    console.log('Saved to temp.html. length:', html.length);
  });
