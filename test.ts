const proc = Bun.spawn(["echo", "hello"]);
const output = await proc.stdout.text();
console.log(output); // Should print "hello"