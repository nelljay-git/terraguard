const fs = require('fs');
const html = fs.readFileSync('details.txt', 'utf8');

const mapUrlMatch = /<img[^>]+src=["']([^"']+)["'][^>]*>/i.exec(html); // Or find the specific image. Wait, the main PHIVOLCS logo is also an image.

// Let's just output the text content of the table rows and other text.
const bodyContent = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

console.log(bodyContent.substring(0, 1500));

// Also let's extract all image sources
const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
let imgMatch;
console.log("Images:");
while ((imgMatch = imgRegex.exec(html)) !== null) {
  console.log(imgMatch[1]);
}
