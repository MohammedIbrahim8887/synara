// @hutch cli=0.29.0
export default {
  electrobun: { version: "2.0.6" },
  scripts: {
    build: ["hutch", "electrobun", "build", "--env=dev"],
    smoke: ["hutch", "electrobun", "run", "--env=dev"],
  },
};
