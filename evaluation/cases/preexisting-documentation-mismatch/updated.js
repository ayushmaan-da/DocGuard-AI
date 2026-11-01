app.get("/users", (req, res) => {
  console.log("collection requested");
  res.json({ users });
});
