document.addEventListener("DOMContentLoaded", function () {
  var container = document.body;
  var toggle = document.getElementById("toggle-night-mode");

  var scheme = "light";
  var savedScheme = localStorage.getItem("scheme");
  var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (prefersDark) {
    scheme = "dark";
  }

  if (savedScheme) {
    scheme = savedScheme;
  }

  setScheme(toggle, container, scheme);

  toggle.addEventListener("click", function (e) {
    e.preventDefault();
    var newScheme = container.classList.contains("light") ? "dark" : "light";
    setScheme(toggle, container, newScheme);
  });
});

function setScheme(toggle, container, scheme) {
  localStorage.setItem("scheme", scheme);
  toggle.className = scheme;
  container.className = scheme;
}
