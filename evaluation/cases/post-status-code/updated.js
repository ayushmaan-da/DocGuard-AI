app.post("/users", (req, res) => {
  res.status(200).json(req.body);
});
