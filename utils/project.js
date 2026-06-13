const PROJECT_KEY = "project_settings";

const defaultProject = {
  name: "舒缓伴侣后续",
  code: "qf4M84e"
};

function getWx() {
  if (typeof wx !== "undefined") {
    return wx;
  }
  return null;
}

function getProject() {
  const api = getWx();
  if (!api) {
    return { ...defaultProject };
  }
  return {
    ...defaultProject,
    ...(api.getStorageSync(PROJECT_KEY) || {})
  };
}

function saveProject(input) {
  const project = {
    ...getProject(),
    name: String(input.name || "").trim() || defaultProject.name
  };
  const api = getWx();
  if (api) {
    api.setStorageSync(PROJECT_KEY, project);
  }
  return project;
}

function clearProject() {
  const api = getWx();
  if (api) {
    api.removeStorageSync(PROJECT_KEY);
  }
}

module.exports = {
  PROJECT_KEY,
  defaultProject,
  getProject,
  saveProject,
  clearProject
};
