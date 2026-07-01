export class GrowwBroker {
  constructor() {
    throw new Error(
      "Groww live broker adapter is intentionally not auto-enabled. Use paper mode first, then wire official Groww SDK/API credentials and order endpoints here."
    );
  }
}
