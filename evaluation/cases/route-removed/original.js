app.get("/users/:id", (req, res) => {
  res.json(users.find(user => user.id === req.params.id));
});
