import { createTransportFactory } from '../src/events/pubsub.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(typeof createTransportFactory('postgres') === 'function', 'expected postgres transport factory');
assert(typeof createTransportFactory('redis') === 'function', 'expected redis transport factory');
assert(typeof createTransportFactory('nats') === 'function', 'expected nats transport factory');
assert(createTransportFactory('memory') === null, 'expected no transport factory for memory mode');

console.log('brokerAdapters.test.mjs passed');
