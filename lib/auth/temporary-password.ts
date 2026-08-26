import { randomInt } from "node:crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%*-_+";
const ALL = `${UPPER}${LOWER}${DIGITS}${SYMBOLS}`;

const pick = (characters: string) => characters[randomInt(characters.length)];

export function createTemporaryPassword() {
  const characters = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (characters.length < 20) characters.push(pick(ALL));
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [characters[index], characters[target]] = [characters[target], characters[index]];
  }
  return characters.join("");
}
