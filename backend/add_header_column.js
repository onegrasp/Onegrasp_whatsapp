require('dotenv').config();

async function addColumn() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  const sql = "ALTER TABLE templates ADD COLUMN IF NOT EXISTS header_image_url TEXT DEFAULT '';";
  
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/`, {
    method: 'POST',
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  
  console.log('RPC Status:', response.status);
  
  if (response.status !== 200) {
    // Try the SQL query endpoint directly
    console.log('Trying direct pg endpoint...');
    const r2 = await fetch(`${supabaseUrl}/pg/query`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });
    console.log('Direct Status:', r2.status);
    const body = await r2.text();
    console.log('Response:', body);
  }
}

addColumn().catch(e => console.error(e));
