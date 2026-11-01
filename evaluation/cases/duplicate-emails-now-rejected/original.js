app.post("/users", (req, res) => {
  users.push(req.body);
  res.status(201).json(req.body);
});
