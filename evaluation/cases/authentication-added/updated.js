app.get("/users", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  res.json(users);
});
