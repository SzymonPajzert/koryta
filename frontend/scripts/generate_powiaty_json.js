import fs from 'fs';
import path from 'path';

// Run from the frontend directory
const svgPath = path.join(process.cwd(), 'app/assets/powiaty-simplified.svg');
const jsonPath = path.join(process.cwd(), 'app/assets/poland_powiaty.json');

console.log('Reading SVG file from:', svgPath);
const svgContent = fs.readFileSync(svgPath, 'utf-8');

const results = [];
const pathRegex = /<path [^>]+>/g;
let match;

while ((match = pathRegex.exec(svgContent)) !== null) {
  const pathTag = match[0];
  const dMatch = pathTag.match(/d="([^"]+)"/);
  const idMatch = pathTag.match(/id="([^"]+)"/);
  
  if (dMatch && idMatch) {
    results.push({
      teryt: idMatch[1],
      d: dMatch[1]
    });
  }
}

console.log(`Extracted ${results.length} paths from SVG.`);

if (results.length > 0) {
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));
  console.log(`Successfully generated new ${jsonPath} (size: ${(fs.statSync(jsonPath).size / 1024).toFixed(2)} KB)`);
} else {
  console.error('No paths were extracted. Please check the SVG structure.');
}
