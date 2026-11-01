app.get("/users/:id", (req, res) => {
  const user = users.find(item => item.id === req.params.id);
  res.json(users[0]);
});
