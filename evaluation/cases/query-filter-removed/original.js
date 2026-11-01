app.get("/users", (req, res) => {
  const results = users.filter(user => user.name === req.query.name);
  res.json(results);
});
