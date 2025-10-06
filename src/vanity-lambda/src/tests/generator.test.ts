import { normalizeNumber, wordToDigits, getVanityNumbers } from "../generator";

describe("Vanity Number Generator", () => {
  test("normalizeNumber strips non-digits", () => {
    expect(normalizeNumber("+1-415-555-2671")).toBe("14155552671");
    expect(normalizeNumber("800-CALL-NOW")).toBe("800");
  });

  test("wordToDigits converts correctly", () => {
    expect(wordToDigits("DOG")).toBe("364");
    expect(wordToDigits("FLOWER")).toBe("356937");
  });

  test("generate and pick top", () => {
    const digits = "2255366";
    const top = getVanityNumbers(digits, 5);
    expect(Array.isArray(top)).toBe(true);
  });
});
