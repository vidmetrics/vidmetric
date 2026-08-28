// Runs on Vercel's server, never in the browser.
// Set ANTHROPIC_API_KEY as an environment variable in your Vercel project
// (Project Settings -> Environment Variables).
//
// COST CONTROL: don't build custom rate-limiting here — instead, go to
// https://console.anthropic.com -> Settings -> Billing -> Spend limits and
// set a monthly (or workspace) spend limit on this API key. Once that
// limit is hit, Anthropic itself starts rejecting requests (this function
// then returns a friendly "budget reached" response below), so there is no
// way to accidentally spend more than you've configured. Raise the limit
// there whenever donations come in.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { image, mediaType } = req.body || {};
  if (!image || !mediaType) {
    return res.status(400).json({ error: 'Missing image or mediaType' });
  }
  if (image.length > 8_000_000) {
    return res.status(413).json({ error: 'Image too large' });
  }

  const prompt = `You are reading a screenshot of video analytics (e.g. YouTube Studio). Find exactly these three metrics if visible: views, impressions click-through rate, and average view duration. Ignore everything else in the image (likes, comments, subscribers, ranking, revenue, etc.) — do not extract or mention them.

For each of the three metrics you can see, report:
- "value": the number/text shown exactly as displayed (e.g. "1123", "10,3 %", "1:13").
- "status": "very_good" if a clearly positive/green upward arrow indicator is shown next to it, "good" if a circle-checkmark or neutral/steady indicator is shown, "bad" if a gray/red downward arrow indicator is shown. If no indicator is visible for a metric, default to "good".

Do not write any explanation, cause, or solution text — only extract the raw value and status. If a metric isn't visible in the image, omit its key entirely.

Respond with ONLY raw JSON, no markdown fences, no commentary, in exactly this shape:
{"views":{"value":"...","status":"very_good|good|bad"},"ctr":{"value":"...","status":"very_good|good|bad"},"watchtime":{"value":"...","status":"very_good|good|bad"}}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    if (response.status === 400 || response.status === 429) {
      // Most likely cause once things are running for a while: the spend
      // limit configured in the Anthropic console has been reached.
      return res.status(402).json({ error: 'budget_reached' });
    }

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Anthropic API error' });
    }

    const textBlock = (data.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(502).json({ error: 'No text in response' });

    const clean = textBlock.text.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { return res.status(502).json({ error: 'Could not parse model response' }); }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
