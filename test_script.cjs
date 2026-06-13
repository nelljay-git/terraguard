const https = require('https');
https.get('https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/2024/2024_January.html', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const matches = d.match(/href=[\"']([^\"']*\.html)[\"']/g);
    if (matches && matches.length > 0) {
      console.log(matches.slice(0, 5));
      const link = matches[0].replace(/href=[\"']/, '').replace(/[\"']$/, '');
      const fullUrl = 'https://earthquake.phivolcs.dost.gov.ph/EQLatest-Monthly/2024/' + link;
      console.log('Fetching', fullUrl);
      https.get(fullUrl, r2 => {
        let d2 = '';
        r2.on('data', c => d2 += c);
        r2.on('end', () => console.log(d2.substring(0, 3000)));
      });
    }
  });
});
