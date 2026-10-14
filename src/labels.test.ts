import { defaultLabels, formatFiled, mergeLabels } from "./labels.js";

test("merges the app's labels over the English defaults", () => {
  const merged = mergeLabels({ bug: { send: "Sūtīt" }, back: undefined });
  expect(merged.bug.send).toBe("Sūtīt");
  expect(merged.feature.send).toBe("Send request");
  expect(merged.back).toBe("Back");
  expect(merged.buttonLabel).toBe("Report a bug");
  expect(defaultLabels.bug.send).toBe("Send report");
  expect(mergeLabels()).toEqual(defaultLabels);
});

test("merges an app's kind labels over the defaults key by key", () => {
  const merged = mergeLabels({ feature: { title: "Ideja" }, back: undefined });
  expect(merged.feature.title).toBe("Ideja");
  expect(merged.feature.send).toBe("Send request");
  expect(merged.bug.title).toBe("Report a bug");
  expect(merged.back).toBe("Back");
});

test("puts the request number into the filed line", () => {
  expect(formatFiled(defaultLabels.filed, 42)).toBe("The report number is #42.");
  expect(formatFiled("{number} and {number}", 7)).toBe("7 and 7");
});
