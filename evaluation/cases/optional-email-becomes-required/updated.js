app.post("/users", (req, res) => {
  if (!req.body.email) return res.status(400).json({ error: "email required" });
  users.push(req.body);
  res.status(201).json(req.body);
});
