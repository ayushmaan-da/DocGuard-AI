app.get("/users", (req, res) => {
  return res.status(200).json(users);
});
