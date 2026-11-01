app.post("/users", (req, res) => {
  res.status(201).json(req.body);
});
