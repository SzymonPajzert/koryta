module.exports = async (
  page,
  scenario,
  viewport,
  isReference,
  browserContext,
) => {
  console.log("onBefore: " + scenario.label);
};
