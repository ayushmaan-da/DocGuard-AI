app.post("/users", (req, res) => {
  if (users.some(user => user.email === req.body.email)) return res.status(409).json({ error: "duplicate email" });
  users.push(req.body);
  res.status(201).json(req.body);
});
