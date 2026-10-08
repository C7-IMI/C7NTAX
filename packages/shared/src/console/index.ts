/**
 * The console's shared half: grammar, catalogue, parsing, completion and request building.
 *
 * One module for all three front ends (PLAN-028 §4): the in-app console and the CLI both parse and
 * complete from here, and the API serves the catalogue from here, so the three cannot disagree about
 * what a command is called or what it does.
 */
export * from "./grammar";
export * from "./catalogue";
export * from "./parse";
export * from "./completion";
export * from "./execute";
