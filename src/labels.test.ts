import { defaultLabels, formatFiled, mergeLabels } from "./labels.js";

test("merges the app's labels over the English defaults", () => {
  const merged = mergeLabels({ send: "Sūtīt", cancel: undefined });
  expect(merged.send).toBe("Sūtīt");
  expect(merged.cancel).toBe("Cancel");
  expect(merged.buttonLabel).toBe("Report a bug");
  expect(defaultLabels.send).toBe("Send");
  expect(mergeLabels()).toEqual(defaultLabels);
});

test("puts the request number into the filed line", () => {
  expect(formatFiled(defaultLabels.filed, 42)).toBe("The report number is #42.");
  expect(formatFiled("{number} and {number}", 7)).toBe("7 and 7");
});
