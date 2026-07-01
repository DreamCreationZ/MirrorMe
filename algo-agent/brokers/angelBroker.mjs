export class AngelBroker {
  constructor() {
    throw new Error(
      "Angel One live broker adapter is intentionally not auto-enabled. Use paper mode first, then wire official SmartAPI auth/order flow here."
    );
  }
}
