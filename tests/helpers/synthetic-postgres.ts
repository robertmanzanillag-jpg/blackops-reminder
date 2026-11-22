import net from 'node:net';
const int16=(value:number)=>{const b=Buffer.alloc(2);b.writeInt16BE(value);return b;};
const int32=(value:number)=>{const b=Buffer.alloc(4);b.writeInt32BE(value);return b;};
const text=(value:string)=>Buffer.from(value+'\0');
const message=(kind:string,payload:Buffer)=>Buffer.concat([Buffer.from(kind),int32(payload.length+4),payload]);
/** Loopback-only PostgreSQL protocol fixture. No database, real credentials or provider. */
export async function syntheticPostgres(){
 const sockets:net.Socket[]=[],commands:string[]=[],active=new Set<net.Socket>();
 const server=net.createServer(socket=>{
  sockets.push(socket);active.add(socket);socket.on('close',()=>active.delete(socket));socket.on('error',()=>{});
  let buffer=Buffer.alloc(0),startup=true,inTransaction=false;
  socket.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);
   if(startup){if(buffer.length<4||buffer.length<buffer.readInt32BE(0))return;const size=buffer.readInt32BE(0);buffer=buffer.subarray(size);startup=false;
    socket.write(Buffer.concat([message('R',int32(0)),message('S',Buffer.concat([text('server_version'),text('17.0')])),message('S',Buffer.concat([text('client_encoding'),text('UTF8')])),message('K',Buffer.concat([int32(123),int32(456)])),message('Z',Buffer.from('I'))]));}
   while(buffer.length>=5){const length=buffer.readInt32BE(1);if(buffer.length<length+1)return;const kind=buffer.toString('ascii',0,1),payload=buffer.subarray(5,length+1);buffer=buffer.subarray(length+1);
    if(kind==='X'){socket.end();continue;}if(kind!=='Q')continue;
    const sql=payload.toString().replace(/\0$/,'');commands.push(sql);if(sql==='WAIT')continue;
    if(sql==='BEGIN')inTransaction=true;if(sql==='COMMIT'||sql==='ROLLBACK')inTransaction=false;
    const ready=message('Z',Buffer.from(inTransaction?'T':'I'));
    if(sql.startsWith('SELECT')){
     const field=Buffer.concat([text('value'),int32(0),int16(0),int32(23),int16(4),int32(-1),int16(0)]);
     socket.write(Buffer.concat([message('T',Buffer.concat([int16(1),field])),message('D',Buffer.concat([int16(1),int32(1),Buffer.from('1')])),message('C',text('SELECT 1')),ready]));
    }else socket.write(Buffer.concat([message('C',text(sql)),ready]));
   }
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
 const address=server.address() as net.AddressInfo;
 return {sockets,commands,port:address.port,async close(){for(const socket of active)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
export async function until(check:()=>boolean){const deadline=Date.now()+5000;while(!check()){if(Date.now()>=deadline)throw Error('SYNTHETIC_POSTGRES_EVENT_TIMEOUT');await new Promise(resolve=>setTimeout(resolve,5));}}
