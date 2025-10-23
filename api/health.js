module.exports = (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  return res.json({ status: 'ok', time: new Date().toISOString() });
};
