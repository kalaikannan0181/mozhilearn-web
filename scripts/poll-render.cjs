const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll() {
  const base = 'https://mozhilearn-web-2.onrender.com';
  console.log('Polling Render backend:', base);

  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(base + '/api/test-db');
      const text = await res.text();
      console.log(`[Attempt ${i + 1}] HTTP ${res.status}: ${text.slice(0, 300)}`);
      if (res.status === 200) {
        console.log('SUCCESS! Database endpoint is healthy!');
        return;
      }
    } catch (e) {
      console.log(`[Attempt ${i + 1}] Network error: ${e.message}`);
    }
    await delay(10000);
  }
}

poll();
