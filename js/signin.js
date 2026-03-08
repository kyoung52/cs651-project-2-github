const { useState, useEffect } = React;

function App() {
  const [showCreate, setShowCreate] = useState(false);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [createLogin, setCreateLogin] = useState("");
  const [createPassword, setCreatePassword] = useState("");

  const [refresh, setRefresh] = useState(false);

  useEffect(() => {
    const savedLogin = localStorage.getItem("login");
    const savedPassword = localStorage.getItem("password");

    if (savedLogin) setLogin(savedLogin);
    if (savedPassword) setPassword(savedPassword);
  }, [refresh]);

  const handleSubmit = (e) => {
    e.preventDefault();

    localStorage.setItem("login", login);
    localStorage.setItem("password", password);

    setRefresh(!refresh);
  };

  const handleEnter = (e) => {
    e.preventDefault();

    localStorage.setItem("login", createLogin);
    localStorage.setItem("password", createPassword);

    setShowCreate(false);
    setRefresh(!refresh);
  };

  return (
    <div className="forms-container">
      <form className="vertical-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Login"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit">Submit</button>
        <button type="button" onClick={() => setShowCreate(true)}>Create Account</button>
      </form>

      {showCreate && (
        <form className="vertical-form" onSubmit={handleEnter}>
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="text"
            placeholder="Login"
            value={createLogin}
            onChange={(e) => setCreateLogin(e.target.value)}
          />
          <input
            type="password"
            placeholder="Password"
            value={createPassword}
            onChange={(e) => setCreatePassword(e.target.value)}
          />
          <button type="submit">Enter</button>
        </form>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);