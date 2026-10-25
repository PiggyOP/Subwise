import 'dotenv/config';
import {db,audit} from '../server/db.js';
if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET)throw Error('Razorpay credentials are required');
let failures=0;
for(const row of db.prepare('SELECT * FROM billing').all()){
 try{const response=await fetch('https://api.razorpay.com/v1/subscriptions/'+encodeURIComponent(row.provider_id),{headers:{Authorization:'Basic '+Buffer.from(process.env.RAZORPAY_KEY_ID+':'+process.env.RAZORPAY_KEY_SECRET).toString('base64')},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Provider response '+response.status);const state=await response.json();db.prepare('UPDATE billing SET status=?,period_end=?,last_event=? WHERE user_id=?').run(state.status,state.current_end||null,Math.floor(Date.now()/1000),row.user_id);if(state.status!==row.status)audit(row.user_id,'billing.reconciled',state.status);
 }catch{failures++;console.error('Billing reconciliation failed for a membership.');}
}
db.close();if(failures)process.exitCode=1;
