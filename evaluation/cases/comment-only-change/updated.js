app.get("/users", (req, res) => {
  // Send all records.
  res.json(users);
});
