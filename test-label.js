const fs = require('fs');
const { generateLabelsPDF } = require('./lib/label-generator');

(async () => {
  const labels = [
    {
      name: 'L10m HDMI',
      description: 'Lead audio video HDMI to HDMI L10M',
      price: 49.0,
      barcode_type: 'upca',
      barcode_value: '9320422519548'
    },
    {
      name: 'enDURO AIO PC 24"',
      description: 'All-in-one PC, 24 inch, i5, 16GB',
      price: 1819.0,
      barcode_type: 'code128',
      barcode_value: 'B368118'
    },
    {
      name: 'Wireless KB/M',
      description: 'Wireless keyboard and mouse combo',
      price: 50.0,
      barcode_type: 'code128',
      barcode_value: '2538SY616Q29'
    }
  ];
  const pdf = await generateLabelsPDF(labels);
  fs.writeFileSync('/tmp/test-label.pdf', pdf);
  console.log(`Wrote /tmp/test-label.pdf (${pdf.length} bytes, ${labels.length} labels)`);
})().catch(e => { console.error(e); process.exit(1); });
