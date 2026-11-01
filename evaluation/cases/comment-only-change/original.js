app.get("/users", (req, res) => {
  // Return the full collection.
  res.json(users);
});
