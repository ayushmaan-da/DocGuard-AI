app.delete("/users/:id", (req, res) => {
  res.status(200).json({ deleted: true });
});
