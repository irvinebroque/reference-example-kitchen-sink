'use strict';

module.exports = function createDeprecator(namespace) {
	const emitted = new Set();
	const warn = (message) => {
		const key = `${namespace}:${message}`;
		if (emitted.has(key)) return;
		emitted.add(key);
		console.warn(`[deprecated] ${namespace}: ${message}`);
	};
	const deprecator = (message) => warn(message);
	deprecator.function = (target, message) =>
		function workerdSafeDeprecatedFunction(...arguments_) {
			warn(message);
			return target.apply(this, arguments_);
		};
	deprecator.property = (target, property, message) => {
		const descriptor = Object.getOwnPropertyDescriptor(target, property);
		if (!descriptor?.configurable) return;
		if ('value' in descriptor) {
			let value = descriptor.value;
			Object.defineProperty(target, property, {
				configurable: true,
				enumerable: descriptor.enumerable,
				get() {
					warn(message);
					return value;
				},
				set(next) {
					warn(message);
					value = next;
				},
			});
			return;
		}
		Object.defineProperty(target, property, {
			...descriptor,
			get: descriptor.get
				? function workerdSafeDeprecatedGetter() {
						warn(message);
						return descriptor.get.call(this);
					}
				: descriptor.get,
			set: descriptor.set
				? function workerdSafeDeprecatedSetter(value) {
						warn(message);
						descriptor.set.call(this, value);
					}
				: descriptor.set,
		});
	};
	return deprecator;
};
