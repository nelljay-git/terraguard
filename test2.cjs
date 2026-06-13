const fs = require('fs');
const html = fs.readFileSync('details.txt', 'utf8');

const cleanText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Origin
const originMatch = /Origin\s*:\s*(.*?)\s*Magnitude/i.exec(cleanText);
const origin = originMatch ? originMatch[1].trim() : '';

// Reported Intensities
// Notice the text might contain "Intensity V - ..." 
// Let's use a regex that captures everything until "Instrumental Intensities" or "This is an aftershock" or end
const reportedMatch = /Reported Intensities\s*:\s*(.*?)(?:Instrumental Intensities|This is an aftershock|$)/i.exec(cleanText);
let reported = reportedMatch ? reportedMatch[1].trim() : '';

// Instrumental Intensities
const instrumentalMatch = /Instrumental Intensities\s*:?\s*(.*?)(?:This is an aftershock|$)/i.exec(cleanText);
let instrumental = instrumentalMatch ? instrumentalMatch[1].trim() : '';

// Note
const noteMatch = /(This is an aftershock.*?)(?:$)/i.exec(cleanText);
const note = noteMatch ? noteMatch[1].trim() : '';

// Images
const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
let imgMatch;
let mapUrl = '';
while ((imgMatch = imgRegex.exec(html)) !== null) {
  const src = imgMatch[1].trim();
  if (!src.includes('logo') && !src.includes('header')) {
    mapUrl = src;
    break; // first non-logo image is usually the map
  }
}

console.log({
  origin,
  reported: reported.substring(0, 100) + '...',
  instrumental: instrumental.substring(0, 100) + '...',
  note,
  mapUrl
});
