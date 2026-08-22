import html2pdf from 'html2pdf.js';
import { supabase } from './lib/supabaseClient.js';
import { escapeHTML, formatMoney, formatNumber, formatUpdatedMeta } from './lib/format.js';
import { loadIdentity, signInWithGoogle, signInWithPassword, signOut } from './lib/session.js';
import {
    canEditProject,
    canDeleteProject,
    canManageMembers,
    isOwner,
    describeAccess
} from './lib/permissions.js';
import {
    serialiseAssessment,
    deserialiseAssessment,
    normaliseSnapshot,
    buildProjectPayload,
    isSROIRowStarted
} from './lib/assessmentSnapshot.js';

// Helper to scope draft keys per project ID so projects don't bleed into each other
function getDraftKey() {
    const urlParams = new URLSearchParams(window.location.search);
    const id = urlParams.get('id') || 'new';
    return `sroi-evaluation-draft-${id}`;
}

const OSM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search';
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_DEFAULT_CENTER = [13.7563, 100.5018];
const OSM_DEFAULT_ZOOM = 11;

const SDGs_LIST = [
    { id: 1, title: "ขจัดความยากจน", focus: "รายได้ ความมั่นคงของครัวเรือน การเข้าถึงสวัสดิการ" },
    { id: 2, title: "ยุติความหิวโหย", focus: "อาหาร โภชนาการ เกษตรกรรมยั่งยืน" },
    { id: 3, title: "สุขภาพและความเป็นอยู่ที่ดี", focus: "สุขภาวะ การรักษา การป้องกันโรค" },
    { id: 4, title: "การศึกษาที่มีคุณภาพ", focus: "การเรียนรู้ ทักษะ โอกาสทางการศึกษา" },
    { id: 5, title: "ความเท่าเทียมทางเพศ", focus: "สิทธิ ความปลอดภัย การมีส่วนร่วม" },
    { id: 6, title: "น้ำสะอาดและสุขาภิบาล", focus: "น้ำใช้ สุขอนามัย การจัดการน้ำ" },
    { id: 7, title: "พลังงานสะอาดที่เข้าถึงได้", focus: "พลังงานทางเลือก ประสิทธิภาพพลังงาน" },
    { id: 8, title: "งานที่มีคุณค่าและการเติบโตทางเศรษฐกิจ", focus: "อาชีพ รายได้ ผู้ประกอบการ" },
    { id: 9, title: "อุตสาหกรรม นวัตกรรม และโครงสร้างพื้นฐาน", focus: "นวัตกรรม เทคโนโลยี โครงสร้างพื้นฐาน" },
    { id: 10, title: "ลดความเหลื่อมล้ำ", focus: "กลุ่มเปราะบาง การเข้าถึงบริการ ความเป็นธรรม" },
    { id: 11, title: "เมืองและถิ่นฐานมนุษย์อย่างยั่งยืน", focus: "ชุมชน ที่อยู่อาศัย เมืองปลอดภัย" },
    { id: 12, title: "การผลิตและการบริโภคที่ยั่งยืน", focus: "ทรัพยากร ขยะ ห่วงโซ่อุปทาน" },
    { id: 13, title: "การรับมือการเปลี่ยนแปลงสภาพภูมิอากาศ", focus: "ปรับตัว ลดคาร์บอน ภัยพิบัติ" },
    { id: 14, title: "ทรัพยากรทางทะเล", focus: "ชายฝั่ง ประมง ระบบนิเวศทะเล" },
    { id: 15, title: "ระบบนิเวศทางบก", focus: "ป่า ความหลากหลายทางชีวภาพ ที่ดิน" },
    { id: 16, title: "สังคมสงบสุข ยุติธรรม และสถาบันเข้มแข็ง", focus: "ธรรมาภิบาล ความยุติธรรม ความปลอดภัย" },
    { id: 17, title: "ความร่วมมือเพื่อการพัฒนาที่ยั่งยืน", focus: "เครือข่าย นโยบาย ความร่วมมือข้ามภาคส่วน" }
];

const SDG_TARGETS = {
    1: [
        { code: "1.1", title: "ยุติความยากจนขั้นรุนแรง" },
        { code: "1.2", title: "ลดความยากจนตามนิยามประเทศ" },
        { code: "1.3", title: "ระบบคุ้มครองทางสังคม" },
        { code: "1.4", title: "สิทธิในทรัพยากรและบริการพื้นฐาน" },
        { code: "1.5", title: "ความยืดหยุ่นต่อภัยพิบัติและวิกฤต" },
        { code: "1.a", title: "ระดมทรัพยากรเพื่อขจัดความยากจน" },
        { code: "1.b", title: "นโยบายสนับสนุนคนยากจนและความเท่าเทียม" }
    ],
    2: [
        { code: "2.1", title: "ยุติความหิวโหยและเข้าถึงอาหาร" },
        { code: "2.2", title: "ยุติภาวะทุพโภชนาการ" },
        { code: "2.3", title: "เพิ่มผลิตภาพและรายได้เกษตรกรรายย่อย" },
        { code: "2.4", title: "ระบบผลิตอาหารที่ยั่งยืน" },
        { code: "2.5", title: "รักษาความหลากหลายทางพันธุกรรม" },
        { code: "2.a", title: "ลงทุนด้านเกษตรและวิจัยชนบท" },
        { code: "2.b", title: "แก้ข้อจำกัดและการบิดเบือนการค้าเกษตร" },
        { code: "2.c", title: "ตลาดอาหารและราคาที่มีเสถียรภาพ" }
    ],
    3: [
        { code: "3.1", title: "ลดการตายของมารดา" },
        { code: "3.2", title: "ยุติการตายที่ป้องกันได้ของทารกและเด็ก" },
        { code: "3.3", title: "ยุติโรคเอดส์ วัณโรค มาลาเรีย และโรคติดต่อ" },
        { code: "3.4", title: "ลดการเสียชีวิตก่อนวัยจากโรคไม่ติดต่อและส่งเสริมสุขภาพจิต" },
        { code: "3.5", title: "ป้องกันและบำบัดการใช้สารเสพติด" },
        { code: "3.6", title: "ลดการเสียชีวิตและบาดเจ็บจากถนน" },
        { code: "3.7", title: "เข้าถึงอนามัยเจริญพันธุ์และการวางแผนครอบครัว" },
        { code: "3.8", title: "หลักประกันสุขภาพถ้วนหน้า" },
        { code: "3.9", title: "ลดโรคจากมลพิษและสารเคมี" },
        { code: "3.a", title: "ควบคุมยาสูบ" },
        { code: "3.b", title: "วิจัยและเข้าถึงยา/วัคซีนจำเป็น" },
        { code: "3.c", title: "เพิ่มบุคลากรและงบระบบสุขภาพ" },
        { code: "3.d", title: "เสริมศักยภาพจัดการความเสี่ยงสุขภาพ" }
    ],
    4: [
        { code: "4.1", title: "การศึกษาประถมและมัธยมที่มีคุณภาพ" },
        { code: "4.2", title: "พัฒนาเด็กปฐมวัยและเตรียมความพร้อม" },
        { code: "4.3", title: "เข้าถึงอาชีวศึกษา อุดมศึกษา และการเรียนรู้ผู้ใหญ่" },
        { code: "4.4", title: "ทักษะอาชีพและทักษะดิจิทัล" },
        { code: "4.5", title: "ลดความเหลื่อมล้ำทางการศึกษา" },
        { code: "4.6", title: "การอ่านออกเขียนได้และคำนวณได้" },
        { code: "4.7", title: "การพัฒนาที่ยั่งยืน สิทธิ และพลเมืองโลก" },
        { code: "4.a", title: "สถานศึกษาปลอดภัยและเข้าถึงได้" },
        { code: "4.b", title: "ทุนการศึกษา" },
        { code: "4.c", title: "ครูที่มีคุณภาพ" }
    ],
    5: [
        { code: "5.1", title: "ยุติการเลือกปฏิบัติต่อผู้หญิงและเด็กหญิง" },
        { code: "5.2", title: "ยุติความรุนแรงและการแสวงประโยชน์" },
        { code: "5.3", title: "ยุติการแต่งงานเด็กและการขลิบอวัยวะเพศหญิง" },
        { code: "5.4", title: "เห็นคุณค่างานดูแลที่ไม่ได้รับค่าจ้าง" },
        { code: "5.5", title: "การมีส่วนร่วมและภาวะผู้นำของผู้หญิง" },
        { code: "5.6", title: "สิทธิอนามัยเจริญพันธุ์" },
        { code: "5.a", title: "สิทธิเท่าเทียมในทรัพยากรเศรษฐกิจและที่ดิน" },
        { code: "5.b", title: "ใช้เทคโนโลยีเพื่อเสริมพลังผู้หญิง" },
        { code: "5.c", title: "นโยบายและกฎหมายเพื่อความเท่าเทียมทางเพศ" }
    ],
    6: [
        { code: "6.1", title: "เข้าถึงน้ำดื่มปลอดภัย" },
        { code: "6.2", title: "สุขาภิบาลและสุขอนามัยที่เพียงพอ" },
        { code: "6.3", title: "คุณภาพน้ำและการบำบัดน้ำเสีย" },
        { code: "6.4", title: "ประสิทธิภาพการใช้น้ำและแก้ขาดแคลนน้ำ" },
        { code: "6.5", title: "จัดการทรัพยากรน้ำแบบบูรณาการ" },
        { code: "6.6", title: "ปกป้องระบบนิเวศที่เกี่ยวข้องกับน้ำ" },
        { code: "6.a", title: "ความร่วมมือด้านน้ำและสุขาภิบาล" },
        { code: "6.b", title: "การมีส่วนร่วมของชุมชนในการจัดการน้ำ" }
    ],
    7: [
        { code: "7.1", title: "เข้าถึงพลังงานสมัยใหม่ในราคาที่จ่ายได้" },
        { code: "7.2", title: "เพิ่มสัดส่วนพลังงานหมุนเวียน" },
        { code: "7.3", title: "เพิ่มประสิทธิภาพการใช้พลังงาน" },
        { code: "7.a", title: "ความร่วมมือด้านพลังงานสะอาด" },
        { code: "7.b", title: "โครงสร้างพื้นฐานและเทคโนโลยีพลังงาน" }
    ],
    8: [
        { code: "8.1", title: "การเติบโตทางเศรษฐกิจต่อหัว" },
        { code: "8.2", title: "ผลิตภาพผ่านนวัตกรรมและมูลค่าเพิ่ม" },
        { code: "8.3", title: "ผู้ประกอบการ งานที่มีคุณค่า และธุรกิจขนาดเล็ก" },
        { code: "8.4", title: "ใช้ทรัพยากรอย่างมีประสิทธิภาพ" },
        { code: "8.5", title: "จ้างงานเต็มที่และค่าจ้างเท่าเทียม" },
        { code: "8.6", title: "ลดเยาวชนที่ไม่ได้เรียนหรือทำงาน" },
        { code: "8.7", title: "ยุติแรงงานบังคับ แรงงานเด็ก และค้ามนุษย์" },
        { code: "8.8", title: "สิทธิแรงงานและสภาพแวดล้อมปลอดภัย" },
        { code: "8.9", title: "ท่องเที่ยวยั่งยืนที่สร้างงาน" },
        { code: "8.10", title: "เข้าถึงบริการการเงิน" },
        { code: "8.a", title: "ช่วยเหลือเพื่อการค้า" },
        { code: "8.b", title: "ยุทธศาสตร์การจ้างงานเยาวชน" }
    ],
    9: [
        { code: "9.1", title: "โครงสร้างพื้นฐานที่ยั่งยืนและเข้าถึงได้" },
        { code: "9.2", title: "อุตสาหกรรมที่ครอบคลุมและยั่งยืน" },
        { code: "9.3", title: "ธุรกิจขนาดเล็กเข้าถึงบริการการเงินและห่วงโซ่มูลค่า" },
        { code: "9.4", title: "ปรับปรุงอุตสาหกรรมให้สะอาดและใช้ทรัพยากรคุ้มค่า" },
        { code: "9.5", title: "วิจัย นวัตกรรม และเทคโนโลยี" },
        { code: "9.a", title: "สนับสนุนโครงสร้างพื้นฐานในประเทศกำลังพัฒนา" },
        { code: "9.b", title: "พัฒนาเทคโนโลยีและนวัตกรรมภายในประเทศ" },
        { code: "9.c", title: "เข้าถึง ICT และอินเทอร์เน็ต" }
    ],
    10: [
        { code: "10.1", title: "เพิ่มรายได้ของกลุ่มล่างสุด" },
        { code: "10.2", title: "เสริมพลังและความครอบคลุมทางสังคม เศรษฐกิจ การเมือง" },
        { code: "10.3", title: "โอกาสเท่าเทียมและลดการเลือกปฏิบัติ" },
        { code: "10.4", title: "นโยบายการคลัง ค่าจ้าง และคุ้มครองทางสังคม" },
        { code: "10.5", title: "กำกับดูแลตลาดและสถาบันการเงิน" },
        { code: "10.6", title: "เสียงของประเทศกำลังพัฒนาในสถาบันโลก" },
        { code: "10.7", title: "การย้ายถิ่นที่ปลอดภัยและมีระเบียบ" },
        { code: "10.a", title: "หลักปฏิบัติพิเศษทางการค้า" },
        { code: "10.b", title: "ความช่วยเหลือและเงินทุนเพื่อการพัฒนา" },
        { code: "10.c", title: "ลดต้นทุนการส่งเงินกลับประเทศ" }
    ],
    11: [
        { code: "11.1", title: "ที่อยู่อาศัยและบริการพื้นฐานที่ปลอดภัย" },
        { code: "11.2", title: "ระบบขนส่งปลอดภัยและเข้าถึงได้" },
        { code: "11.3", title: "เมืองที่มีส่วนร่วมและยั่งยืน" },
        { code: "11.4", title: "คุ้มครองมรดกทางวัฒนธรรมและธรรมชาติ" },
        { code: "11.5", title: "ลดผลกระทบจากภัยพิบัติ" },
        { code: "11.6", title: "ลดผลกระทบสิ่งแวดล้อมของเมือง" },
        { code: "11.7", title: "พื้นที่สาธารณะและพื้นที่สีเขียวปลอดภัย" },
        { code: "11.a", title: "เชื่อมโยงเมือง ชนบท และภูมิภาค" },
        { code: "11.b", title: "นโยบายเมืองด้านความยืดหยุ่นและภัยพิบัติ" },
        { code: "11.c", title: "สนับสนุนอาคารยั่งยืนในประเทศพัฒนาน้อยที่สุด" }
    ],
    12: [
        { code: "12.1", title: "แผนการผลิตและบริโภคที่ยั่งยืน" },
        { code: "12.2", title: "จัดการทรัพยากรธรรมชาติอย่างยั่งยืน" },
        { code: "12.3", title: "ลดขยะอาหาร" },
        { code: "12.4", title: "จัดการสารเคมีและของเสียอย่างปลอดภัย" },
        { code: "12.5", title: "ลดของเสียด้วยป้องกัน ลด ใช้ซ้ำ รีไซเคิล" },
        { code: "12.6", title: "ความยั่งยืนในองค์กรและการรายงาน" },
        { code: "12.7", title: "จัดซื้อจัดจ้างภาครัฐที่ยั่งยืน" },
        { code: "12.8", title: "ข้อมูลและความตระหนักเพื่อวิถียั่งยืน" },
        { code: "12.a", title: "วิทยาศาสตร์และเทคโนโลยีเพื่อการบริโภคยั่งยืน" },
        { code: "12.b", title: "ติดตามผลกระทบท่องเที่ยวยั่งยืน" },
        { code: "12.c", title: "ปรับลดอุดหนุนเชื้อเพลิงฟอสซิลที่ไม่มีประสิทธิภาพ" }
    ],
    13: [
        { code: "13.1", title: "ความยืดหยุ่นต่อภัยพิบัติและภูมิอากาศ" },
        { code: "13.2", title: "บูรณาการมาตรการภูมิอากาศในนโยบาย" },
        { code: "13.3", title: "การศึกษาและศักยภาพด้านภูมิอากาศ" },
        { code: "13.a", title: "ระดมทุนด้านภูมิอากาศ" },
        { code: "13.b", title: "ศักยภาพการวางแผนภูมิอากาศในประเทศเปราะบาง" }
    ],
    14: [
        { code: "14.1", title: "ลดมลพิษทางทะเล" },
        { code: "14.2", title: "จัดการระบบนิเวศทะเลและชายฝั่ง" },
        { code: "14.3", title: "ลดผลกระทบกรดในมหาสมุทร" },
        { code: "14.4", title: "ประมงยั่งยืนและยุติการจับเกินขนาด" },
        { code: "14.5", title: "อนุรักษ์พื้นที่ชายฝั่งและทะเล" },
        { code: "14.6", title: "ยุติเงินอุดหนุนประมงที่เป็นอันตราย" },
        { code: "14.7", title: "ประโยชน์เศรษฐกิจจากทรัพยากรทะเลอย่างยั่งยืน" },
        { code: "14.a", title: "วิทยาศาสตร์และเทคโนโลยีทางทะเล" },
        { code: "14.b", title: "สิทธิประมงรายย่อย" },
        { code: "14.c", title: "กฎหมายทะเลและการอนุรักษ์" }
    ],
    15: [
        { code: "15.1", title: "อนุรักษ์ระบบนิเวศบนบกและน้ำจืด" },
        { code: "15.2", title: "จัดการป่าไม้ยั่งยืนและฟื้นฟูป่า" },
        { code: "15.3", title: "ต่อสู้การแปรสภาพเป็นทะเลทรายและฟื้นฟูที่ดิน" },
        { code: "15.4", title: "อนุรักษ์ระบบนิเวศภูเขา" },
        { code: "15.5", title: "ลดการสูญเสียความหลากหลายทางชีวภาพ" },
        { code: "15.6", title: "แบ่งปันประโยชน์จากทรัพยากรพันธุกรรม" },
        { code: "15.7", title: "ยุติการล่าและค้าสัตว์ป่าผิดกฎหมาย" },
        { code: "15.8", title: "จัดการชนิดพันธุ์ต่างถิ่นรุกราน" },
        { code: "15.9", title: "บูรณาการคุณค่าระบบนิเวศในแผนและบัญชี" },
        { code: "15.a", title: "ระดมทรัพยากรเพื่อความหลากหลายทางชีวภาพ" },
        { code: "15.b", title: "ทรัพยากรเพื่อจัดการป่าไม้อย่างยั่งยืน" },
        { code: "15.c", title: "สนับสนุนการต่อต้านล่าและค้าสัตว์ป่า" }
    ],
    16: [
        { code: "16.1", title: "ลดความรุนแรงและการเสียชีวิต" },
        { code: "16.2", title: "ยุติการล่วงละเมิด แสวงประโยชน์ และความรุนแรงต่อเด็ก" },
        { code: "16.3", title: "หลักนิติธรรมและการเข้าถึงความยุติธรรม" },
        { code: "16.4", title: "ลดเงินผิดกฎหมาย อาวุธผิดกฎหมาย และอาชญากรรมองค์กร" },
        { code: "16.5", title: "ลดคอร์รัปชันและสินบน" },
        { code: "16.6", title: "สถาบันที่มีประสิทธิภาพและโปร่งใส" },
        { code: "16.7", title: "การตัดสินใจที่ตอบสนองและมีส่วนร่วม" },
        { code: "16.8", title: "การมีส่วนร่วมของประเทศกำลังพัฒนาในธรรมาภิบาลโลก" },
        { code: "16.9", title: "อัตลักษณ์ทางกฎหมายและทะเบียนเกิด" },
        { code: "16.10", title: "เข้าถึงข้อมูลและคุ้มครองเสรีภาพพื้นฐาน" },
        { code: "16.a", title: "ศักยภาพสถาบันในการป้องกันความรุนแรง" },
        { code: "16.b", title: "กฎหมายและนโยบายไม่เลือกปฏิบัติ" }
    ],
    17: [
        { code: "17.1", title: "ระดมทรัพยากรภายในประเทศ" },
        { code: "17.2", title: "พันธกรณีความช่วยเหลือเพื่อการพัฒนา" },
        { code: "17.3", title: "ระดมทุนเพิ่มเติมเพื่อประเทศกำลังพัฒนา" },
        { code: "17.4", title: "ความยั่งยืนด้านหนี้" },
        { code: "17.5", title: "ส่งเสริมการลงทุนในประเทศพัฒนาน้อยที่สุด" },
        { code: "17.6", title: "ความร่วมมือวิทยาศาสตร์ เทคโนโลยี และนวัตกรรม" },
        { code: "17.7", title: "ถ่ายทอดเทคโนโลยีที่เป็นมิตรต่อสิ่งแวดล้อม" },
        { code: "17.8", title: "ธนาคารเทคโนโลยีและ ICT" },
        { code: "17.9", title: "เสริมศักยภาพประเทศกำลังพัฒนา" },
        { code: "17.10", title: "ระบบการค้าพหุภาคีที่เป็นธรรม" },
        { code: "17.11", title: "เพิ่มการส่งออกของประเทศกำลังพัฒนา" },
        { code: "17.12", title: "การเข้าถึงตลาดปลอดภาษีและโควตา" },
        { code: "17.13", title: "เสถียรภาพเศรษฐกิจมหภาคโลก" },
        { code: "17.14", title: "ความสอดคล้องเชิงนโยบายเพื่อการพัฒนาที่ยั่งยืน" },
        { code: "17.15", title: "เคารพพื้นที่นโยบายของแต่ละประเทศ" },
        { code: "17.16", title: "หุ้นส่วนระดับโลกเพื่อการพัฒนาที่ยั่งยืน" },
        { code: "17.17", title: "หุ้นส่วนภาครัฐ เอกชน และประชาสังคม" },
        { code: "17.18", title: "ข้อมูลและสถิติที่มีคุณภาพ" },
        { code: "17.19", title: "ตัวชี้วัดความก้าวหน้านอกเหนือ GDP" }
    ]
};

export const appState = {
    currentView: 'view-landing',
    currentStep: 1,
    totalSteps: 6,
    uploadedImage: null,
    activityImages: [],
    isViewMode: false,
    // Has the user actually changed anything THIS session, as opposed to just having
    // opened a project or clicked "Edit"? Drives whether goHome() bothers them with the
    // "saved as a draft" confirm -- reset wherever a session starts clean (new project,
    // opening/resuming an existing one, entering edit mode), set by scheduleSave()
    // (every real field-level change goes through it).
    isDirty: false,
    sroiRows: [],
    areaMap: null,
    areaMarker: null,
    areaRectangle: null,
    boundaryLayerGroup: null,
    boundaryFeatureLookup: new Map(),
    selectedBoundaryIds: new Set(),
    boundaryAutoLoadTimer: null,
    boundaryLastLoadKey: '',
    areaDragStart: null,
    isDrawingArea: false,
    mapSelectionMode: 'pin',
    areaSearchResults: [],
    boundarySearchResults: [],
    lastGeocodeAt: 0,
    saveTimer: null,
    autosaveAttached: false,

    // Who is signed in, the project row being viewed, and what they may do with it.
    // Filled by applyProjectAccess(). These shape the UI only -- RLS enforces.
    identity: null,
    projectMeta: null,
    // Researcher emails queued while creating a brand-new (not yet saved) project --
    // there is no project id yet for add_project_researcher() to attach to. Invited for
    // real by saveProjectData()'s insert branch right after the row is created, then
    // cleared. In-memory only: does not survive a page reload (not part of the local
    // draft shape), only the current creation session.
    pendingMembers: [],
    projectAccess: {
        canEdit: false,
        canDelete: false,
        canManageMembers: false,
        isOwner: false
    },

    /**
     * Work out what this user may do with this project.
     *
     * @param identity from loadIdentity()
     * @param project  the row, or null for a project that has not been saved yet
     */
    applyProjectAccess(identity, project) {
        this.identity = identity ?? this.identity;
        this.projectMeta = project ?? null;

        if (!project) {
            // Unsaved project: the person creating it is its owner, so they can see
            // (and, once the project is saved, use) the researcher panel. renderMemberPanel()
            // already disables the add-input and shows "save first" via #member-locked
            // while there's no project id yet.
            this.projectAccess = {
                canEdit: !!this.identity,
                canDelete: false,
                canManageMembers: !!this.identity,
                isOwner: true
            };
        } else {
            this.projectAccess = {
                canEdit: canEditProject(this.identity, project),
                canDelete: canDeleteProject(this.identity, project),
                canManageMembers: canManageMembers(this.identity, project),
                isOwner: isOwner(this.identity, project)
            };
        }

        // Permission may only ever TIGHTEN this flag, never loosen it.
        if (!this.projectAccess.canEdit) this.isViewMode = true;

        this.renderAccessBanner();
        this.renderMemberPanel();
    },

    canEdit() {
        return this.projectAccess.canEdit;
    },

    // ---- Researchers on this project -------------------------------------------

    /** The current project's uuid, or null for one that has not been saved yet. */
    getProjectId() {
        return new URLSearchParams(window.location.search).get('id');
    },

    renderMemberPanel() {
        const panel = document.getElementById('member-panel');
        if (!panel) return;

        // Only the owner and admins manage the team. Everyone else never sees it.
        if (!this.projectAccess.canManageMembers) {
            panel.classList.add('hidden');
            return;
        }
        panel.classList.remove('hidden');

        const projectId = this.getProjectId();
        const input = document.getElementById('member-email-input');
        const addBtn = document.getElementById('member-add-btn');
        const locked = document.getElementById('member-locked');

        // Unsaved project: no row to attach a researcher to yet, so addProjectMember()
        // queues emails in this.pendingMembers instead of calling the RPC -- the add
        // input/button stay enabled (only #member-locked's wording changes, in
        // index.html, to explain they're invited once the project is saved).
        const unsaved = !projectId;
        if (input) input.disabled = false;
        if (addBtn) addBtn.disabled = false;
        locked?.classList.toggle('hidden', !unsaved);

        const members = unsaved
            ? this.pendingMembers.map(m => ({ member_email: m.email, member_name: m.name, queued: true }))
            : (this.projectMeta?.project_members ?? []);
        const list = document.getElementById('member-list');
        const count = document.getElementById('member-count');

        if (count) {
            count.textContent = members.length
                ? `${members.length} คน`
                : 'ยังไม่มีผู้ร่วมวิจัย';
        }

        if (!list) return;

        if (members.length === 0) {
            list.innerHTML = `<span class="text-xs text-gray-400">${
                unsaved ? '' : 'เฉพาะคุณเท่านั้นที่เข้าถึงโครงการนี้'
            }</span>`;
            return;
        }

        // Chips hold other people's names/addresses, so everything is escaped.
        list.innerHTML = members.map(member => {
            const email = String(member.member_email ?? '');
            const name = String(member.member_name ?? '').trim();
            // "queued" = added before the project exists, invited on first save.
            // "pending" = already invited, just hasn't signed in for the first time yet.
            // Different situations, so a different label/color each.
            const queued = !!member.queued;
            const pending = !queued && !member.user_id;
            return `
                <span class="inline-flex items-center gap-2 bg-white border ${
                    queued ? 'border-blue-200' : pending ? 'border-yellow-300' : 'border-gray-200'
                } rounded-full pl-3 pr-1 py-1 text-xs" data-testid="member-chip">
                    <span class="font-medium text-gray-700">${name ? `${escapeHTML(name)} &lt;${escapeHTML(email)}&gt;` : escapeHTML(email)}</span>
                    ${queued ? '<span class="text-blue-600">(จะเชิญเมื่อบันทึก)</span>' : ''}
                    ${pending ? '<span class="text-yellow-600">(รอเข้าสู่ระบบ)</span>' : ''}
                    <button type="button" title="นำออกจากโครงการ"
                            data-testid="member-remove-btn"
                            onclick="appState.removeProjectMember('${escapeHTML(email).replaceAll("'", '&#039;')}')"
                            class="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </span>`;
        }).join('');
    },

    showMemberFeedback(message, kind = 'ok') {
        const el = document.getElementById('member-feedback');
        if (!el) return;
        el.textContent = message;
        el.className = `text-xs mt-2 ${kind === 'error' ? 'text-red-600' : 'text-green-700'}`;
        el.classList.remove('hidden');
    },

    async addProjectMember() {
        if (!this.projectAccess.canManageMembers) return;

        const projectId = this.getProjectId();
        const nameInput = document.getElementById('member-name-input');
        const input = document.getElementById('member-email-input');
        if (!input) return;

        const email = input.value.trim().toLowerCase();
        const name = (nameInput?.value ?? '').trim();

        // Cheap local checks first, so obvious mistakes cost no round trip.
        if (!email || !input.checkValidity()) {
            this.showMemberFeedback('รูปแบบอีเมลไม่ถูกต้อง (Invalid email address)', 'error');
            return;
        }
        if (email === this.identity?.email) {
            this.showMemberFeedback('คุณเป็นเจ้าของโครงการนี้อยู่แล้ว (You already own this project)', 'error');
            return;
        }

        // No project row yet -- queue locally, invite for real once saveProjectData()'s
        // insert branch creates the row (see saveProjectData()). No RPC to call: there
        // is no project id for add_project_researcher() to attach to.
        if (!projectId) {
            if (this.pendingMembers.some(m => m.email === email)) {
                this.showMemberFeedback('อีเมลนี้อยู่ในรายชื่อแล้ว (Already queued)', 'error');
                return;
            }
            this.pendingMembers.push({ name, email });
            if (nameInput) nameInput.value = '';
            input.value = '';
            this.showMemberFeedback(`จะเชิญ ${email} เป็นผู้ร่วมวิจัยเมื่อบันทึกโครงการ`, 'ok');
            this.renderMemberPanel();
            return;
        }

        if ((this.projectMeta?.project_members ?? []).some(
            m => String(m.member_email ?? '').toLowerCase() === email)) {
            this.showMemberFeedback('อีเมลนี้เป็นผู้ร่วมวิจัยอยู่แล้ว (Already a researcher on this project)', 'error');
            return;
        }

        // An RPC, not a plain insert: the browser has no access to the accounts list,
        // so resolving an email to a user id has to happen server-side. See
        // add_project_researcher in supabase/migrations/0005_rls_v2.sql.
        const { data, error } = await supabase.rpc('add_project_researcher', {
            p_project_id: projectId,
            p_email: email
        });

        if (error) {
            console.error('Could not add researcher:', error);
            this.showMemberFeedback('เพิ่มผู้ร่วมวิจัยไม่สำเร็จ (Could not add researcher)', 'error');
            return;
        }

        const status = data?.status;
        const messages = {
            added:    `เพิ่ม ${email} เป็นผู้ร่วมวิจัยแล้ว`,
            invited:  `${email} ยังไม่มีบัญชี — ระบบจะเพิ่มให้อัตโนมัติเมื่อเข้าสู่ระบบครั้งแรก`,
            is_owner: 'อีเมลนี้เป็นเจ้าของโครงการอยู่แล้ว',
            already:  'อีเมลนี้เป็นผู้ร่วมวิจัยอยู่แล้ว'
        };
        this.showMemberFeedback(
            messages[status] ?? 'ดำเนินการเรียบร้อย',
            status === 'added' || status === 'invited' ? 'ok' : 'error'
        );

        if (status === 'added' || status === 'invited') {
            // Name is stored separately (set_project_researcher_name, see
            // supabase/migrations/0002_project_members_name.sql) -- add_project_researcher
            // itself only ever took an email, so this keeps that function untouched.
            if (name) {
                const { error: nameError } = await supabase.rpc('set_project_researcher_name', {
                    p_project_id: projectId,
                    p_email: email,
                    p_name: name
                });
                if (nameError) console.error('Could not save researcher name:', nameError);
            }
            if (nameInput) nameInput.value = '';
            input.value = '';
            await this.refreshProjectMembers();
        }
    },

    async removeProjectMember(email) {
        if (!this.projectAccess.canManageMembers) return;
        if (!email) return;

        const projectId = this.getProjectId();

        // Nothing was committed yet -- just drop it from the local queue, no RPC,
        // no confirm needed for something that was never actually saved.
        if (!projectId) {
            this.pendingMembers = this.pendingMembers.filter(queued => queued.email !== email);
            this.renderMemberPanel();
            return;
        }

        if (!confirm(`นำ ${email} ออกจากโครงการนี้?\n(Remove this researcher from the project?)`)) return;

        const { data, error } = await supabase.rpc('remove_project_researcher', {
            p_project_id: projectId,
            p_email: email
        });

        if (error) {
            console.error('Could not remove researcher:', error);
            this.showMemberFeedback('นำออกไม่สำเร็จ (Could not remove researcher)', 'error');
            return;
        }

        this.showMemberFeedback(
            data?.status === 'removed' ? `นำ ${email} ออกแล้ว` : 'ไม่พบผู้ร่วมวิจัยรายนี้',
            data?.status === 'removed' ? 'ok' : 'error'
        );
        await this.refreshProjectMembers();
    },

    /** Re-read the team from the database rather than trusting local edits. */
    async refreshProjectMembers() {
        const projectId = this.getProjectId();
        if (!projectId || !this.projectMeta) return;

        const { data, error } = await supabase
            .from('project_members')
            .select('user_id, member_email, member_name, added_at')
            .eq('project_id', projectId);

        if (error) {
            console.error('Could not reload researchers:', error);
            return;
        }

        this.projectMeta = { ...this.projectMeta, project_members: data ?? [] };
        this.renderMemberPanel();
    },

    renderAccessBanner() {
        const el = document.getElementById('project-access-banner');
        if (!el) return;

        if (!this.projectMeta || !this.identity) {
            el.classList.add('hidden');
            return;
        }

        const { canEdit } = this.projectAccess;
        const role = describeAccess(this.identity, this.projectMeta);
        const meta = formatUpdatedMeta(this.projectMeta);

        el.className = `mb-4 rounded-xl px-4 py-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1 ${
            canEdit
                ? 'bg-blue-50 border border-blue-100 text-blue-800'
                : 'bg-gray-50 border border-gray-200 text-gray-600'
        }`;
        el.innerHTML =
            `<span class="font-bold"><i class="fa-solid fa-user-shield mr-2"></i>${escapeHTML(role)}</span>` +
            (meta ? `<span class="text-xs opacity-80">${escapeHTML(meta)}</span>` : '');
        el.classList.remove('hidden');
    },

    init() {
        this.sroiRows = [this.createSROIRow()];
        this.renderObjectiveInputs();
        this.renderActivityPhotoSlots();
        this.renderSDGs();
        this.renderStepper();
        this.renderSROIRows();
        this.attachAutoSaveListeners();
        this.loadDraft();
        this.syncObjectivesFromHidden();
        this.updateKeyTakeawayCounter();
        this.updateSelectedSDGs();
        this.calculateSROIPreview();
        this.updateLiveSummary();
        this.setMapSelectionMode(this.getValue('m_location_type') || 'pin', false);
        this.syncBoundarySelectionFromFields();
        this.updateAreaLocationUI();
    },

    showView(viewId) {
        document.getElementById('view-landing').classList.add('hidden');
        document.getElementById('view-login').classList.add('hidden');
        document.getElementById('view-app').classList.add('hidden');
        document.getElementById(viewId).classList.remove('hidden');
        this.currentView = viewId;

        if (viewId === 'view-landing') this.initLandingCarousel();
    },

    carouselTimer: null,

    // Landing page's rotating banner. Guarded by carouselTimer so re-entering
    // view-landing (e.g. "กลับหน้าหลัก" from the member sign-in form) doesn't stack
    // a second interval on top of the first, doubling the rotation speed.
    initLandingCarousel() {
        const slides = document.querySelectorAll('#landing-carousel [data-carousel-slide]');
        const dotsContainer = document.getElementById('landing-carousel-dots');
        if (!slides.length || !dotsContainer) return;

        if (this.carouselTimer) return; // already running

        let active = 0;
        const dots = slides.length > 1
            ? Array.from(slides).map((_, index) => {
                const dot = document.createElement('button');
                dot.type = 'button';
                dot.setAttribute('aria-label', `Slide ${index + 1}`);
                dot.className = 'w-2 h-2 rounded-full transition-colors ' + (index === 0 ? 'bg-white' : 'bg-white/50');
                dot.onclick = () => showSlide(index);
                dotsContainer.appendChild(dot);
                return dot;
            })
            : [];

        const showSlide = (index) => {
            slides[active].classList.replace('opacity-100', 'opacity-0');
            dots[active]?.classList.replace('bg-white', 'bg-white/50');
            active = index;
            slides[active].classList.replace('opacity-0', 'opacity-100');
            dots[active]?.classList.replace('bg-white/50', 'bg-white');
        };

        this.carouselTimer = window.setInterval(() => {
            showSlide((active + 1) % slides.length);
        }, 4000);
    },

    async login() {
        try {
            await signInWithGoogle();
        } catch (error) {
            console.error("Login failed:", error);
            alert("เกิดข้อผิดพลาดในการเข้าสู่ระบบ (Login error occurred)");
        }
    },

    /** Member sign-in (สมาชิก/บุคคลทั่วไป). Wired to the #view-login form. */
    async loginWithPassword(event) {
        event?.preventDefault();

        const emailEl = document.getElementById('login-email');
        const passwordEl = document.getElementById('login-password');
        const submit = document.getElementById('login-submit');
        if (!emailEl || !passwordEl || !submit) return;

        const email = emailEl.value.trim();
        const password = passwordEl.value; // never trimmed, never logged

        if (!email || !password) {
            this.showLoginError('กรอกอีเมลและรหัสผ่านให้ครบ (Enter both email and password)');
            return;
        }
        if (!emailEl.checkValidity()) {
            this.showLoginError('รูปแบบอีเมลไม่ถูกต้อง (Invalid email format)');
            return;
        }

        this.hideLoginError();
        const originalLabel = submit.innerHTML;
        submit.disabled = true;
        submit.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังเข้าสู่ระบบ...';

        try {
            const result = await signInWithPassword(email, password);
            if (!result.ok) {
                this.showLoginError(result.message);
                return;
            }
            passwordEl.value = ''; // don't leave the credential sitting in the DOM
            window.location.assign('/dashboard.html');
        } finally {
            submit.disabled = false;
            submit.innerHTML = originalLabel;
        }
    },

    showLoginError(message) {
        const el = document.getElementById('login-error');
        if (!el) return;
        el.textContent = message; // textContent, not innerHTML
        el.classList.remove('hidden');
    },

    hideLoginError() {
        document.getElementById('login-error')?.classList.add('hidden');
    },

    togglePasswordVisibility() {
        const input = document.getElementById('login-password');
        const icon = document.getElementById('login-password-toggle-icon');
        if (!input) return;
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        if (icon) icon.className = reveal ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
    },

    async logout() {
        // signOut() clears this app's drafts and redirects. Pass redirectTo: null so
        // the existing form-clearing below still runs first.
        await signOut({ redirectTo: null });

        this.currentStep = 1;
        this.uploadedImage = null;
        this.activityImages = [];
        this.sroiRows = [];
        this.isViewMode = false;

        document.querySelectorAll('input, textarea').forEach(el => {
            if (el.type !== 'file') {
                el.value = '';
            }
        });
        document.querySelectorAll('select').forEach(el => { el.selectedIndex = 0; });
        document.querySelectorAll('.sdg-checkbox').forEach(cb => cb.checked = false);

        window.history.replaceState({}, document.title, window.location.pathname);
        window.location.href = window.location.pathname;
    },

    goHome() {
        // Only prompt when there is actually unsaved typing to report -- not just
        // because the form is in an editable state. Clicking "แก้ไขข้อมูล" (or
        // "New Assessment") and leaving without changing anything is not an edit,
        // so isDirty (set only by scheduleSave(), i.e. a real field-level change)
        // stays false and no confirm shows.
        if (this.currentView === 'view-app' && !this.isViewMode && this.isDirty) {
            if (!confirm('ข้อมูลถูกบันทึกเป็น draft บนเครื่องนี้ ต้องการกลับสู่หน้าหลักหรือไม่?')) return;
        }
        window.location.href = '/dashboard.html';
    },

    renderSDGs() {
        const container = document.getElementById('sdg-container');
        let html = '';
        SDGs_LIST.forEach((sdg) => {
            const value = `SDG ${sdg.id}: ${sdg.title}`;
            const targets = SDG_TARGETS[sdg.id] ?? [];
            const targetSearch = targets.map(target => `${target.code} ${target.title}`).join(' ');
            const search = `${sdg.id} ${sdg.title} ${sdg.focus} ${targetSearch}`.toLowerCase();
            html += `
                <label class="cursor-pointer relative sdg-card" data-sdg-card data-search="${this.escapeHTML(search)}">
                    <input type="checkbox" class="sdg-checkbox peer sr-only" value="${this.escapeHTML(value)}" data-sdg-id="${sdg.id}">
                    <div class="h-full p-3 border-2 border-gray-200 rounded-lg hover:border-chula-light transition-colors text-sm flex items-start gap-3">
                        <div class="w-8 h-8 rounded-full bg-gray-100 flex-shrink-0 flex items-center justify-center text-xs font-bold text-gray-500">
                            ${sdg.id}
                        </div>
                        <div>
                            <span class="font-semibold text-gray-800 leading-tight block">${this.escapeHTML(sdg.title)}</span>
                            <span class="text-xs text-gray-500 leading-snug mt-1 block">${this.escapeHTML(sdg.focus)}</span>
                        </div>
                    </div>
                </label>
            `;
        });
        container.innerHTML = html;
    },

    parseObjectiveText(value) {
        return String(value || '')
            .split(/\n+/)
            .map(item => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
            .filter(Boolean);
    },

    renderObjectiveInputs(values = ['']) {
        const container = document.getElementById('objective-list');
        if (!container) return;

        const objectiveValues = values.length ? values : [''];
        container.innerHTML = objectiveValues.map((value, index) => `
            <div class="objective-row">
                <div class="objective-number">${index + 1}</div>
                <textarea rows="2" class="objective-input form-control resize-none" placeholder="ระบุวัตถุประสงค์ข้อที่ ${index + 1}">${this.escapeHTML(value)}</textarea>
                <button type="button" onclick="appState.removeObjective(this)" class="objective-remove-button" aria-label="ลบวัตถุประสงค์ข้อที่ ${index + 1}">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `).join('');
        this.updateObjectiveHidden(false);
        this.updateObjectiveRemoveButtons();
    },

    addObjective(value = '') {
        if (this.isViewMode) return;
        const values = this.getObjectiveValues();
        values.push(value);
        this.renderObjectiveInputs(values);
        this.scheduleSave();
        this.updateLiveSummary();

        window.setTimeout(() => {
            const inputs = document.querySelectorAll('.objective-input');
            inputs[inputs.length - 1]?.focus();
        }, 0);
    },

    removeObjective(button) {
        if (this.isViewMode) return;
        const row = button?.closest('.objective-row');
        if (!row) return;
        row.remove();
        this.renumberObjectives();
        this.updateObjectiveHidden();
        this.updateObjectiveRemoveButtons();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    getObjectiveValues(includeBlank = true) {
        const values = Array.from(document.querySelectorAll('.objective-input')).map(input => input.value);
        return includeBlank ? values : values.map(value => value.trim()).filter(Boolean);
    },

    updateObjectiveHidden(shouldRenumber = true) {
        const hidden = document.getElementById('m_objective');
        if (!hidden) return;
        hidden.value = this.getObjectiveValues(false).join('\n');
        if (shouldRenumber) this.renumberObjectives();
    },

    syncObjectivesFromHidden() {
        const hidden = document.getElementById('m_objective');
        const values = this.parseObjectiveText(hidden?.value);
        this.renderObjectiveInputs(values.length ? values : ['']);
    },

    renumberObjectives() {
        document.querySelectorAll('.objective-row').forEach((row, index) => {
            row.querySelector('.objective-number').textContent = index + 1;
            const input = row.querySelector('.objective-input');
            const button = row.querySelector('.objective-remove-button');
            if (input) input.placeholder = `ระบุวัตถุประสงค์ข้อที่ ${index + 1}`;
            if (button) button.setAttribute('aria-label', `ลบวัตถุประสงค์ข้อที่ ${index + 1}`);
        });
    },

    updateObjectiveRemoveButtons() {
        const rows = document.querySelectorAll('.objective-row');
        rows.forEach(row => {
            const button = row.querySelector('.objective-remove-button');
            if (!button) return;
            button.disabled = rows.length <= 1 || this.isViewMode;
            button.classList.toggle('opacity-40', button.disabled);
            button.classList.toggle('cursor-not-allowed', button.disabled);
        });
    },

    countWords(value) {
        const text = String(value || '').trim();
        if (!text) return 0;

        if (typeof Intl !== 'undefined' && Intl.Segmenter) {
            const segmenter = new Intl.Segmenter(['th', 'en'], { granularity: 'word' });
            return Array.from(segmenter.segment(text)).filter(segment => segment.isWordLike).length;
        }

        return text.split(/\s+/).filter(Boolean).length;
    },

    updateKeyTakeawayCounter() {
        const input = document.getElementById('sv_key_takeaway');
        const counter = document.getElementById('sv_key_takeaway_counter');
        const warning = document.getElementById('sv_key_takeaway_warning');
        if (!input || !counter) return;

        const limit = Number(input.dataset.wordLimit) || 80;
        const count = this.countWords(input.value);
        const overLimit = count > limit;
        counter.textContent = `${count}/${limit} words`;
        counter.classList.toggle('text-red-600', overLimit);
        counter.classList.toggle('text-gray-400', !overLimit);
        input.classList.toggle('border-red-300', overLimit);
        input.classList.toggle('focus:ring-red-200', overLimit);
        warning?.classList.toggle('hidden', !overLimit);
    },

    renderStepper() {
        const container = document.getElementById('stepper-container').querySelector('.flex');
        let stepsHtml = '';
        const stepNames = ["Metadata", "I-1 SDGs", "I-2/I-3 Pathway", "S-1 Evidence", "S-2 SROI", "S-3 Report"];
        
        for(let i=1; i<=this.totalSteps; i++) {
            stepsHtml += `
                <div class="flex flex-col items-center relative z-10 w-1/6 cursor-pointer hover:opacity-75" id="step-indicator-${i}" onclick="appState.goToStep(${i})">
                    <div class="w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm bg-white transition-colors duration-300 ${i===1 ? 'step-active' : 'step-inactive'}">
                        ${i}
                    </div>
                    <span class="stepper-label text-xs mt-2 font-medium ${i===1 ? 'text-chula' : 'text-gray-400'} hidden md:block text-center px-1">${stepNames[i-1]}</span>
                </div>
            `;
        }
        container.innerHTML = stepsHtml;
    },

    goToStep(step) {
        // While actively editing, step 6 (the finished report) is only reachable through
        // the recheck-and-save flow, never by clicking the stepper directly -- otherwise
        // unsaved changes could be "viewed" as a report without ever being persisted.
        if (!this.isViewMode && step === this.totalSteps) {
            return;
        }

        // Someone who COULD edit is nudged to press "แก้ไขข้อมูล" first (unchanged).
        // Someone with view-only access is free to browse every step -- the inputs are
        // disabled anyway, and there is no Edit button for them to press.
        if (this.isViewMode && this.canEdit() && step !== this.totalSteps) {
            alert("กรุณากดปุ่ม 'แก้ไขข้อมูล' ก่อนทำการแก้ไข (Please click the Edit button before modifying data)");
            return;
        }

        this.currentStep = step;
        this.updateStepUI();
        window.scrollTo({top: 0, behavior: 'smooth'});
    },

    enableEditMode() {
        // The only way out of read-only, and it is reachable from an inline onclick
        // via window.appState, so it must check for itself. A blocked write would
        // otherwise only fail later, at save time, after the user had retyped everything.
        if (!this.canEdit()) {
            alert('คุณมีสิทธิ์ดูรายงานเท่านั้น (You have view-only access to this project)');
            return;
        }

        this.isViewMode = false;
        this.currentStep = 1;
        this.isDirty = false; // clicking Edit alone is not an edit -- goHome() checks this
        this.updateStepUI();

        setTimeout(() => {
            const firstInput = document.getElementById('m_projectName');
            if (firstInput) {
                firstInput.focus();
            }
        }, 50);
    },

    updateStepUI() {
        for(let i=1; i<=this.totalSteps; i++) {
            const indicator = document.getElementById(`step-indicator-${i}`);
            const circle = indicator.querySelector('div');
            const text = indicator.querySelector('span');
            
            if(i === this.currentStep) {
                circle.className = "w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-colors duration-300 step-active";
                text.className = "stepper-label text-xs mt-2 font-medium text-chula hidden md:block text-center px-1";
            } else if (i < this.currentStep) {
                circle.className = "w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-colors duration-300 bg-chula-light border-chula-light text-white";
                text.className = "stepper-label text-xs mt-2 font-medium text-gray-600 hidden md:block text-center px-1";
            } else {
                circle.className = "w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-sm transition-colors duration-300 step-inactive";
                text.className = "stepper-label text-xs mt-2 font-medium text-gray-400 hidden md:block text-center px-1";
            }
        }

        document.querySelectorAll('.step-content').forEach(el => el.classList.add('hidden'));
        document.getElementById(`step-${this.currentStep}`).classList.remove('hidden');

        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const btnSaveStep = document.getElementById('btn-save-step');
        const btnFinalSave = document.getElementById('btn-final-save');
        const formNav = document.getElementById('form-navigation');

        if (this.currentStep === 1) {
            btnPrev.classList.add('hidden');
        } else {
            btnPrev.classList.remove('hidden');
        }

        // Hidden on the report step: #report-container already leads with the project
        // name, so the chip would just repeat it directly above.
        const projectTitleChipBar = document.getElementById('project-title-chip-bar');
        if (projectTitleChipBar) {
            projectTitleChipBar.classList.toggle('hidden', this.currentStep === this.totalSteps);
        }

        if (this.currentStep === this.totalSteps) {
            formNav.classList.add('hidden');
            this.generateReport();

            // Step 6 is only ever reached after confirmAndSave() already ran from the
            // step-5 recheck modal -- there is no save button here (see index.html).
            // "แก้ไขข้อมูล" shows only for someone who may actually edit; a view-only
            // visitor gets no edit affordance at all rather than a button that refuses.
            const btnEdit = document.getElementById('btn-edit-assessment');
            if (btnEdit) {
                btnEdit.classList.toggle('hidden', !(this.isViewMode && this.canEdit()));
            }
        } else {
            formNav.classList.remove('hidden');

            // On the last input step an editor gets "สรุปผลเป็นรายงาน" in place of
            // "ถัดไป": it opens the recheck modal and saves, rather than silently
            // walking onto a report of unsaved numbers. Read-only visitors keep plain
            // "ถัดไป" -- they have nothing to commit, and step 6 stays reachable from
            // the stepper for everyone either way.
            const offerFinalSave = this.currentStep === this.totalSteps - 1 && !this.isViewMode;

            if (btnFinalSave) btnFinalSave.classList.toggle('hidden', !offerFinalSave);
            btnNext.classList.toggle('hidden', offerFinalSave);

            if (this.currentStep === this.totalSteps - 1) {
                btnNext.innerHTML = 'ประมวลผลรายงาน <i class="fa-solid fa-file-invoice ml-2"></i>';
                btnNext.classList.remove('bg-chula');
                btnNext.classList.add('bg-gray-900', 'hover:bg-black');
            } else {
                btnNext.innerHTML = 'ถัดไป <i class="fa-solid fa-arrow-right ml-2"></i>';
                btnNext.classList.add('bg-chula');
                btnNext.classList.remove('bg-gray-900', 'hover:bg-black');
            }

            // Nothing to save while read-only, so the button would only confuse.
            //
            // Visibility is driven by sm:flex, NOT by toggling 'hidden'. The button is
            // desktop-only ('hidden sm:flex'), and Tailwind emits media-query utilities
            // after the base ones -- so sm:flex beats 'hidden' above 640px and adding
            // 'hidden' would fail to hide it on exactly the screens it shows on.
            // Leaving 'hidden' permanently on and gating sm:flex gets both states right.
            if (btnSaveStep) {
                btnSaveStep.classList.add('hidden');
                btnSaveStep.classList.toggle('sm:flex', !this.isViewMode);
            }
        }

        // Scoped to #view-app. This used to sweep the whole document, which now would
        // also disable the login form and the researcher-management inputs.
        // [data-readonly-exempt] opts a subtree out -- the member panel stays usable
        // for an owner reading a saved report.
        document.querySelectorAll('#view-app input, #view-app textarea, #view-app select').forEach(el => {
            if (el.closest('[data-readonly-exempt]')) return;

            if (this.isViewMode) {
                el.disabled = true;
                el.readOnly = true;
                el.setAttribute('disabled', 'true');
                el.setAttribute('readonly', 'true');
                el.classList.add('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            } else {
                el.disabled = false;
                el.readOnly = false;
                el.removeAttribute('disabled');
                el.removeAttribute('readonly');
                el.classList.remove('bg-gray-100', 'cursor-not-allowed', 'opacity-70');
            }
        });

        if (!this.isViewMode) {
            setTimeout(() => {
                const currentStepContainer = document.getElementById(`step-${this.currentStep}`);
                if (currentStepContainer) {
                    const firstInput = currentStepContainer.querySelector('input[type="text"], input[type="number"], textarea');
                    if (firstInput) {
                        firstInput.focus();
                    }
                }
            }, 50);
        }

        this.updateObjectiveRemoveButtons();
        this.updateLiveSummary();
        if (this.currentStep === 1) {
            window.setTimeout(() => this.initAreaMap(), 0);
        }
    },

    nextStep() {
        if (this.currentStep >= this.totalSteps) return;

        this.currentStep++;
        this.updateStepUI();
        window.scrollTo({top: 0, behavior: 'smooth'});

        // Local draft only. This used to call saveProjectData() with just
        // { projectName, currentStep }, which overwrote the entire assessment_data
        // column and destroyed every previously saved answer. Writes to the server
        // are now only ever explicit, via confirmAndSave().
        this.saveDraft();
    },

    // The autosave debounce and nextStep() both already write the draft, so this saves
    // nothing new -- it exists so the user can SEE that their typing is safe without
    // having to leave the step. Local draft only, like every other implicit write;
    // reaching the database still takes confirmAndSave().
    saveCurrentStepLocal() {
        this.saveDraft();

        const btn = document.getElementById('btn-save-step');
        if (!btn) return;

        // Guard against a double-click restoring the "Saved" label as the original.
        if (btn.dataset.confirming === 'true') return;
        btn.dataset.confirming = 'true';

        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i>บันทึกแล้ว (Saved)';
        btn.classList.replace('text-chula', 'text-green-600');
        btn.classList.replace('border-chula', 'border-green-600');

        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.replace('text-green-600', 'text-chula');
            btn.classList.replace('border-green-600', 'border-chula');
            delete btn.dataset.confirming;
        }, 2000);
    },

    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.updateStepUI();
            window.scrollTo({top: 0, behavior: 'smooth'});
        }
    },

    showPathwayPanel(panelId) {
        document.querySelectorAll('[data-pathway-panel]').forEach(panel => {
            panel.classList.toggle('hidden', panel.dataset.pathwayPanel !== panelId);
        });
        document.querySelectorAll('[data-pathway-tab]').forEach(tab => {
            const active = tab.dataset.pathwayTab === panelId;
            tab.classList.toggle('framework-tab-active', active);
            tab.classList.toggle('framework-tab-idle', !active);
        });
    },

    initAreaMap() {
        const mapEl = document.getElementById('area-map');
        if (!mapEl) return;

        if (!window.L) {
            this.setAreaMapStatus('โหลดแผนที่ไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต');
            return;
        }

        if (!this.areaMap) {
            this.areaMap = window.L.map(mapEl, { scrollWheelZoom: false }).setView(OSM_DEFAULT_CENTER, OSM_DEFAULT_ZOOM);
            window.L.tileLayer(OSM_TILE_URL, {
                maxZoom: 19,
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(this.areaMap);
            this.boundaryLayerGroup = window.L.layerGroup().addTo(this.areaMap);
            this.areaMap.on('click', (event) => {
                if (this.mapSelectionMode !== 'pin') return;

                this.setProjectLocation({
                    lat: event.latlng.lat,
                    lng: event.latlng.lng,
                    displayName: 'ตำแหน่งที่ปักหมุดเอง',
                    label: this.getValue('m_location_label') || 'ตำแหน่งที่ปักหมุดเอง'
                });
            });
            this.areaMap.on('mousedown', (event) => this.startAreaDrag(event.latlng));
            this.areaMap.on('mousemove', (event) => this.updateAreaDrag(event.latlng));
            this.areaMap.on('mouseup', (event) => this.finishAreaDrag(event.latlng));
            this.areaMap.on('mouseout', (event) => {
                if (this.isDrawingArea && event.latlng) this.finishAreaDrag(event.latlng);
            });
        }

        window.setTimeout(() => {
            this.areaMap.invalidateSize();
            this.syncAreaMarkerFromFields();
        }, 0);
    },

    setAreaMapStatus(message) {
        const status = document.getElementById('area-map-status');
        if (status) status.innerText = message;
    },

    setMapSelectionMode(mode, updateStatus = true) {
        this.mapSelectionMode = ['pin', 'area', 'boundary'].includes(mode) ? mode : 'pin';
        const typeInput = document.getElementById('m_location_type');
        if (typeInput && !this.getValue('m_lat')) typeInput.value = this.mapSelectionMode;

        ['pin', 'area', 'boundary'].forEach(item => {
            const button = document.getElementById(`map-mode-${item}`);
            if (!button) return;
            const active = item === this.mapSelectionMode;
            button.classList.toggle('map-mode-button-active', active);
            button.classList.toggle('map-mode-button-idle', !active);
        });

        const boundaryControls = document.getElementById('boundary-controls');
        if (boundaryControls) {
            boundaryControls.classList.toggle('hidden', this.mapSelectionMode !== 'boundary');
        }

        const mapEl = document.getElementById('area-map');
        if (mapEl) mapEl.classList.toggle('area-map-draw-mode', this.mapSelectionMode === 'area');
        if (this.areaMap) {
            if (this.mapSelectionMode === 'area') {
                this.areaMap.dragging.disable();
            } else {
                this.areaMap.dragging.enable();
            }
        }

        if (this.mapSelectionMode === 'area') {
            this.areaDragStart = null;
            this.isDrawingArea = false;
            if (updateStatus) this.setAreaMapStatus('โหมดกำหนดพื้นที่: ลากบนแผนที่เพื่อคลุมพื้นที่ดำเนินงาน');
        } else if (this.mapSelectionMode === 'boundary') {
            this.areaDragStart = null;
            this.isDrawingArea = false;
            if (updateStatus) {
                this.setAreaMapStatus('โหมดเลือกขอบเขต: พิมพ์ชื่อตำบล/อำเภอเพื่อค้นหาและวาง shape หรือกดรีเฟรช boundary layer');
            }
        } else {
            document.getElementById('boundary-search-results')?.classList.add('hidden');
            if (updateStatus) this.setAreaMapStatus('โหมดปักหมุด: คลิกบนแผนที่เพื่อเลือกตำแหน่งโครงการ');
        }
    },

    scheduleBoundaryAutoLoad() {
        window.clearTimeout(this.boundaryAutoLoadTimer);
        this.boundaryAutoLoadTimer = window.setTimeout(() => {
            if (this.mapSelectionMode === 'boundary') this.loadVisibleBoundaries({ force: false });
        }, 350);
    },

    parseBounds(boundingbox) {
        if (!Array.isArray(boundingbox) || boundingbox.length !== 4) return null;
        const [south, north, west, east] = boundingbox.map(Number);
        if (![south, north, west, east].every(Number.isFinite)) return null;
        if (south === north || west === east) return null;
        return { south, north, west, east };
    },

    getBoundsFromFields() {
        const bounds = {
            south: this.parseNumberValue(this.getValue('m_bounds_south')),
            north: this.parseNumberValue(this.getValue('m_bounds_north')),
            west: this.parseNumberValue(this.getValue('m_bounds_west')),
            east: this.parseNumberValue(this.getValue('m_bounds_east'))
        };
        if (![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite)) return null;
        if (!this.getValue('m_bounds_south') || !this.getValue('m_bounds_north') || !this.getValue('m_bounds_west') || !this.getValue('m_bounds_east')) return null;
        if (bounds.south === bounds.north || bounds.west === bounds.east) return null;
        return bounds;
    },

    getBoundsFromLatLngs(first, second) {
        const bounds = {
            south: Math.min(first.lat, second.lat),
            north: Math.max(first.lat, second.lat),
            west: Math.min(first.lng, second.lng),
            east: Math.max(first.lng, second.lng)
        };
        if (Math.abs(bounds.north - bounds.south) < 0.00005 || Math.abs(bounds.east - bounds.west) < 0.00005) return null;
        return bounds;
    },

    startAreaDrag(latlng) {
        if (this.mapSelectionMode !== 'area' || !this.areaMap || !window.L) return;
        this.areaDragStart = latlng;
        this.isDrawingArea = true;
        this.setAreaMapStatus('กำลังลากคลุมพื้นที่...');
    },

    updateAreaDrag(latlng) {
        if (!this.isDrawingArea || !this.areaDragStart || !this.areaMap || !window.L) return;
        const bounds = this.getBoundsFromLatLngs(this.areaDragStart, latlng);
        if (!bounds) return;
        this.setAreaRectangle(bounds, this.getSelectedLocationLabel('พื้นที่ที่กำหนดเอง'), false, true);
    },

    finishAreaDrag(latlng) {
        if (!this.isDrawingArea || !this.areaDragStart) return;
        const bounds = this.getBoundsFromLatLngs(this.areaDragStart, latlng);
        this.areaDragStart = null;
        this.isDrawingArea = false;

        if (!bounds) {
            this.setAreaMapStatus('ลากให้ครอบพื้นที่กว้างขึ้นอีกนิดเพื่อบันทึกขอบเขต');
            return;
        }

        this.setProjectArea({
            bounds,
            displayName: 'พื้นที่ที่กำหนดเอง',
            label: this.getValue('m_location_label') || 'พื้นที่ที่กำหนดเอง'
        });
    },

    getBoundaryCacheKey(bounds, adminLevel) {
        const rounded = [bounds.south, bounds.west, bounds.north, bounds.east]
            .map(value => Number(value).toFixed(3))
            .join(',');
        return `osm-boundaries:${adminLevel}:${rounded}`;
    },

    getBoundaryLevelLabel(adminLevel) {
        if (String(adminLevel) === '6') return 'อำเภอ/เขต';
        if (String(adminLevel) === '8') return 'ตำบล/แขวง';
        return 'ขอบเขต';
    },

    getBoundaryQueryBounds() {
        if (!this.areaMap) return null;
        const bounds = this.areaMap.getBounds();
        const south = bounds.getSouth();
        const north = bounds.getNorth();
        const west = bounds.getWest();
        const east = bounds.getEast();
        if (![south, north, west, east].every(Number.isFinite)) return null;
        return { south, north, west, east };
    },

    buildBoundaryQuery(bounds, adminLevel) {
        const levelMatcher = adminLevel === 'all' ? '^(6|8)$' : `^${adminLevel}$`;
        return `
            [out:json][timeout:25];
            (
              relation["boundary"="administrative"]["admin_level"~"${levelMatcher}"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});
            );
            out body geom;
        `;
    },

    async loadVisibleBoundaries({ force = true } = {}) {
        if (!this.areaMap || !window.L) {
            this.setAreaMapStatus('แผนที่ยังไม่พร้อม ลองเปิดขั้นตอนนี้ใหม่อีกครั้ง');
            return;
        }

        this.setMapSelectionMode('boundary', false);
        const bounds = this.getBoundaryQueryBounds();
        const adminLevel = document.getElementById('boundary-admin-level')?.value || '8';
        if (!bounds) return;

        const latSpan = Math.abs(bounds.north - bounds.south);
        const lngSpan = Math.abs(bounds.east - bounds.west);
        if (latSpan > 1.2 || lngSpan > 1.2) {
            this.setAreaMapStatus('ขอบเขตกว้างเกินไป กรุณาค้นหาพื้นที่หรือ zoom เข้าใกล้ก่อนโหลดตำบล/อำเภอ');
            return;
        }

        const cacheKey = this.getBoundaryCacheKey(bounds, adminLevel);
        if (!force && cacheKey === this.boundaryLastLoadKey && this.boundaryFeatureLookup.size > 0) {
            this.setAreaMapStatus('Boundary layer ถูกวางอยู่แล้ว คลิก shape เพื่อเลือก/ยกเลิก หรือกดรีเฟรชหลังเลื่อนแผนที่');
            return;
        }
        this.boundaryLastLoadKey = cacheKey;

        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                const features = JSON.parse(cached);
                this.renderBoundaryLayers(features);
                this.setAreaMapStatus(`โหลดขอบเขตจาก cache ${features.length} รายการ คลิก shape เพื่อเลือก/ยกเลิก`);
                return;
            } catch (error) {
                console.warn('Could not parse cached boundary result', error);
            }
        }

        this.setAreaMapStatus('กำลังโหลดขอบเขตตำบล/อำเภอจาก OpenStreetMap...');
        try {
            const query = this.buildBoundaryQuery(bounds, adminLevel);
            const response = await fetch(OVERPASS_ENDPOINT, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
                },
                body: `data=${encodeURIComponent(query)}`
            });
            if (!response.ok) throw new Error(`Overpass failed: ${response.status}`);

            const data = await response.json();
            const features = this.overpassToBoundaryFeatures(data)
                .filter(feature => feature.geometry)
                .sort((a, b) => {
                    const levelDiff = Number(a.properties.adminLevel) - Number(b.properties.adminLevel);
                    if (levelDiff !== 0) return levelDiff;
                    return a.properties.name.localeCompare(b.properties.name, 'th');
                });

            try {
                localStorage.setItem(cacheKey, JSON.stringify(features));
            } catch (error) {
                console.warn('Could not cache boundary result', error);
            }
            this.renderBoundaryLayers(features);
            this.setAreaMapStatus(features.length
                ? `พบขอบเขต ${features.length} รายการ คลิก shape เพื่อเลือกได้มากกว่า 1 ตำบล/อำเภอ`
                : 'ไม่พบ boundary ในบริเวณนี้ ลอง zoom ออกเล็กน้อยหรือเปลี่ยนระดับขอบเขต');
        } catch (error) {
            console.warn(error);
            this.setAreaMapStatus('โหลดขอบเขตไม่สำเร็จ ลองใหม่อีกครั้ง หรือใช้โหมดลากกำหนดพื้นที่แทน');
        }
    },

    getBoundarySearchCacheKey(query, adminLevel) {
        return `osm-boundary-search:${adminLevel}:${query.trim().toLowerCase()}`;
    },

    async searchBoundaryByName() {
        const query = this.getValue('boundary-search').trim();
        const adminLevel = document.getElementById('boundary-admin-level')?.value || '8';
        if (!query) {
            this.setAreaMapStatus('พิมพ์ชื่อตำบล/อำเภอก่อนค้นหา boundary');
            return;
        }

        this.setMapSelectionMode('boundary');
        const cacheKey = this.getBoundarySearchCacheKey(query, adminLevel);
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                this.boundarySearchResults = JSON.parse(cached);
                this.renderBoundarySearchResults();
                this.setAreaMapStatus(`พบ ${this.boundarySearchResults.length} boundary จาก cache`);
                return;
            } catch (error) {
                console.warn('Could not parse cached boundary search', error);
            }
        }

        this.setAreaMapStatus('กำลังค้นหา boundary shape จาก OpenStreetMap...');
        try {
            const params = new URLSearchParams({
                format: 'jsonv2',
                q: query,
                countrycodes: 'th',
                limit: '8',
                'accept-language': 'th,en',
                addressdetails: '1',
                extratags: '1',
                namedetails: '1',
                polygon_geojson: '1'
            });
            const response = await fetch(`${OSM_SEARCH_ENDPOINT}?${params.toString()}`, {
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) throw new Error(`Boundary search failed: ${response.status}`);

            const results = await response.json();
            const features = (Array.isArray(results) ? results : [])
                .map(result => this.nominatimResultToBoundaryFeature(result))
                .filter(Boolean);
            const wantedLevels = adminLevel === 'all' ? ['6', '8'] : [adminLevel];
            const exactLevelFeatures = features.filter(feature => wantedLevels.includes(String(feature.properties.adminLevel)));
            this.boundarySearchResults = (exactLevelFeatures.length ? exactLevelFeatures : features).slice(0, 6);

            try {
                localStorage.setItem(cacheKey, JSON.stringify(this.boundarySearchResults));
            } catch (error) {
                console.warn('Could not cache boundary search', error);
            }

            this.renderBoundarySearchResults();
            this.setAreaMapStatus(this.boundarySearchResults.length
                ? `พบ ${this.boundarySearchResults.length} boundary กด “วาง shape และเลือก” เพื่อเพิ่มลงแผนที่`
                : 'ไม่พบ shape ของตำบล/อำเภอนี้ ลองเพิ่มคำว่า ตำบล/อำเภอ หรือชื่อจังหวัดต่อท้าย');
        } catch (error) {
            console.warn(error);
            this.setAreaMapStatus('ค้นหา boundary ไม่สำเร็จ ลองพิมพ์ชื่อให้เฉพาะขึ้น หรือใช้โหมดรีเฟรช boundary layer');
        }
    },

    nominatimResultToBoundaryFeature(result) {
        const geometry = result?.geojson;
        if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return null;

        const address = result.address ?? {};
        const extratags = result.extratags ?? {};
        const adminLevel = extratags.admin_level
            || (address.subdistrict || address.suburb ? '8' : '')
            || (address.district || address.city_district || address.county ? '6' : '');
        const osmType = String(result.osm_type || 'osm').toLowerCase();
        const osmId = result.osm_id || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const name = result.namedetails?.['name:th']
            || result.name
            || address.subdistrict
            || address.suburb
            || address.district
            || address.city_district
            || result.display_name
            || `OSM ${osmId}`;

        const feature = {
            type: 'Feature',
            properties: {
                id: `${osmType}/${osmId}`,
                osmId,
                name,
                displayName: result.display_name || name,
                adminLevel,
                levelLabel: this.getBoundaryLevelLabel(adminLevel)
            },
            geometry
        };
        feature.properties.bounds = this.getFeatureBounds(feature);
        return feature;
    },

    renderBoundarySearchResults() {
        const container = document.getElementById('boundary-search-results');
        if (!container) return;

        if (!this.boundarySearchResults.length) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        container.classList.remove('hidden');
        container.innerHTML = this.boundarySearchResults.map((feature, index) => `
            <div class="map-result boundary-search-result">
                <span class="font-semibold text-gray-900">${this.escapeHTML(feature.properties.name)}</span>
                <span class="text-xs text-gray-500">${this.escapeHTML(feature.properties.levelLabel || 'Boundary')} · ${this.escapeHTML(feature.properties.displayName || '')}</span>
                <div class="map-result-actions">
                    <button type="button" onclick="appState.selectBoundarySearchResult(${index})">
                        <i class="fa-solid fa-draw-polygon mr-1"></i>วาง shape และเลือก
                    </button>
                </div>
            </div>
        `).join('');
    },

    selectBoundarySearchResult(index) {
        const feature = this.boundarySearchResults[index];
        if (!feature) return;

        this.setMapSelectionMode('boundary', false);
        this.renderBoundaryLayers([feature], { clear: false });
        if (!this.selectedBoundaryIds.has(feature.properties.id)) {
            const next = this.getBoundarySelection().concat([this.boundarySelectionFromFeature(feature)]);
            this.setBoundarySelection(next);
            this.applyBoundarySelectionToFields();
        }
        this.updateBoundaryLayerStyles();
        this.updateSelectedBoundaryList();

        const bounds = feature.properties.bounds || this.getFeatureBounds(feature);
        if (bounds && this.areaMap) {
            this.areaMap.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]], { padding: [28, 28], maxZoom: 14 });
        }

        const resultsEl = document.getElementById('boundary-search-results');
        if (resultsEl) resultsEl.classList.add('hidden');
        this.setAreaMapStatus(`วาง shape “${feature.properties.name}” แล้ว คลิก shape เพื่อยกเลิก หรือค้นหาเพิ่มได้`);
        this.scheduleSave();
    },

    overpassToBoundaryFeatures(data) {
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        return elements
            .filter(element => element.type === 'relation' && element.tags?.boundary === 'administrative')
            .map(element => this.relationToBoundaryFeature(element))
            .filter(Boolean);
    },

    relationToBoundaryFeature(element) {
        const outerLines = (element.members ?? [])
            .filter(member => member.type === 'way' && member.role !== 'inner' && Array.isArray(member.geometry) && member.geometry.length >= 2)
            .map(member => member.geometry.map(point => [Number(point.lon), Number(point.lat)]));

        const outerRings = this.stitchBoundaryRings(outerLines);
        if (outerRings.length === 0) return null;

        const name = element.tags?.['name:th'] || element.tags?.name || element.tags?.['name:en'] || `OSM relation ${element.id}`;
        const adminLevel = element.tags?.admin_level || '';
        const id = `relation/${element.id}`;
        const polygons = outerRings.map(ring => [ring]);
        const geometry = polygons.length === 1
            ? { type: 'Polygon', coordinates: polygons[0] }
            : { type: 'MultiPolygon', coordinates: polygons };

        const feature = {
            type: 'Feature',
            properties: {
                id,
                osmId: element.id,
                name,
                adminLevel,
                levelLabel: this.getBoundaryLevelLabel(adminLevel)
            },
            geometry
        };
        feature.properties.bounds = this.getFeatureBounds(feature);
        return feature;
    },

    stitchBoundaryRings(lines) {
        const remaining = lines
            .filter(line => line.length >= 2)
            .map(line => line.map(coord => [coord[0], coord[1]]));
        const rings = [];

        while (remaining.length) {
            let ring = remaining.shift();
            let changed = true;

            while (changed && !this.isClosedRing(ring)) {
                changed = false;
                for (let index = 0; index < remaining.length; index++) {
                    const line = remaining[index];
                    const first = ring[0];
                    const last = ring[ring.length - 1];
                    const lineFirst = line[0];
                    const lineLast = line[line.length - 1];

                    if (this.sameCoord(last, lineFirst)) {
                        ring = ring.concat(line.slice(1));
                    } else if (this.sameCoord(last, lineLast)) {
                        ring = ring.concat([...line].reverse().slice(1));
                    } else if (this.sameCoord(first, lineLast)) {
                        ring = line.slice(0, -1).concat(ring);
                    } else if (this.sameCoord(first, lineFirst)) {
                        ring = [...line].reverse().slice(0, -1).concat(ring);
                    } else {
                        continue;
                    }

                    remaining.splice(index, 1);
                    changed = true;
                    break;
                }
            }

            if (!this.isClosedRing(ring) && ring.length >= 3) ring = ring.concat([ring[0]]);
            if (ring.length >= 4 && this.isClosedRing(ring)) rings.push(ring);
        }

        return rings;
    },

    sameCoord(a, b) {
        if (!a || !b) return false;
        return Math.abs(a[0] - b[0]) < 0.0000001 && Math.abs(a[1] - b[1]) < 0.0000001;
    },

    isClosedRing(ring) {
        return ring.length >= 4 && this.sameCoord(ring[0], ring[ring.length - 1]);
    },

    getFeatureBounds(feature) {
        const coords = [];
        const collect = value => {
            if (!Array.isArray(value)) return;
            if (typeof value[0] === 'number' && typeof value[1] === 'number') {
                coords.push(value);
                return;
            }
            value.forEach(collect);
        };
        collect(feature.geometry?.coordinates);
        if (!coords.length) return null;

        const lngs = coords.map(coord => coord[0]);
        const lats = coords.map(coord => coord[1]);
        return {
            south: Math.min(...lats),
            north: Math.max(...lats),
            west: Math.min(...lngs),
            east: Math.max(...lngs)
        };
    },

    getBoundaryStyle(feature) {
        const selected = this.selectedBoundaryIds.has(feature.properties.id);
        return {
            color: selected ? '#e11d48' : '#2563eb',
            weight: selected ? 5 : 2,
            fillColor: selected ? '#fb7185' : '#60a5fa',
            fillOpacity: selected ? 0.42 : 0.12,
            opacity: selected ? 1 : 0.75,
            dashArray: selected ? '' : '6 4'
        };
    },

    renderBoundaryLayers(features, { clear = true, fitSelected = false } = {}) {
        if (!this.areaMap || !window.L) return;
        if (!this.boundaryLayerGroup) this.boundaryLayerGroup = window.L.layerGroup().addTo(this.areaMap);
        if (clear) {
            this.boundaryLayerGroup.clearLayers();
            this.boundaryFeatureLookup = new Map();
        }

        const selected = this.getBoundarySelection();
        const featureIds = new Set(features.map(feature => feature.properties.id));
        const combinedFeatures = features.concat(selected
            .filter(item => item.geometry && !featureIds.has(item.id))
            .map(item => this.boundarySelectionToFeature(item)));

        combinedFeatures.forEach(feature => {
            if (!feature?.geometry || this.boundaryFeatureLookup.has(feature.properties.id)) return;
            this.boundaryFeatureLookup.set(feature.properties.id, feature);
            const layer = window.L.geoJSON(feature, {
                style: item => this.getBoundaryStyle(item),
                onEachFeature: (item, itemLayer) => {
                    itemLayer.on('click', event => {
                        window.L.DomEvent.stopPropagation(event);
                        this.toggleBoundarySelection(item);
                    });
                    itemLayer.bindTooltip(`${item.properties.levelLabel}: ${item.properties.name}`, {
                        sticky: true,
                        direction: 'top'
                    });
                }
            });
            layer.addTo(this.boundaryLayerGroup);
        });

        this.updateBoundaryLayerStyles();
        this.updateSelectedBoundaryList();

        if (fitSelected && selected.length) {
            const bounds = this.getAggregateBounds(selected);
            if (bounds) this.areaMap.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]], { padding: [24, 24], maxZoom: 14 });
        }
    },

    boundarySelectionFromFeature(feature) {
        return {
            id: feature.properties.id,
            osmId: feature.properties.osmId,
            name: feature.properties.name,
            adminLevel: feature.properties.adminLevel,
            levelLabel: feature.properties.levelLabel,
            bounds: feature.properties.bounds || this.getFeatureBounds(feature),
            geometry: feature.geometry
        };
    },

    boundarySelectionToFeature(item) {
        return {
            type: 'Feature',
            properties: {
                id: item.id,
                osmId: item.osmId,
                name: item.name,
                adminLevel: item.adminLevel,
                levelLabel: item.levelLabel || this.getBoundaryLevelLabel(item.adminLevel),
                bounds: item.bounds
            },
            geometry: item.geometry
        };
    },

    getBoundarySelection() {
        const field = document.getElementById('m_boundary_selection_json');
        if (!field?.value) return [];
        try {
            const parsed = JSON.parse(field.value);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('Could not parse selected boundaries', error);
            return [];
        }
    },

    setBoundarySelection(selection) {
        const field = document.getElementById('m_boundary_selection_json');
        if (field) field.value = JSON.stringify(selection ?? []);
        this.selectedBoundaryIds = new Set((selection ?? []).map(item => item.id));
    },

    toggleBoundarySelection(feature) {
        if (this.isViewMode) return;
        const current = this.getBoundarySelection();
        const id = feature.properties.id;
        const exists = current.some(item => item.id === id);
        const next = exists
            ? current.filter(item => item.id !== id)
            : current.concat([this.boundarySelectionFromFeature(feature)]);

        this.setBoundarySelection(next);
        this.applyBoundarySelectionToFields();
        this.updateBoundaryLayerStyles();
        this.updateSelectedBoundaryList();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    removeBoundarySelection(id) {
        if (this.isViewMode) return;
        const next = this.getBoundarySelection().filter(item => item.id !== id);
        this.setBoundarySelection(next);
        this.applyBoundarySelectionToFields();
        this.updateBoundaryLayerStyles();
        this.updateSelectedBoundaryList();
        this.scheduleSave();
    },

    clearBoundarySelection(updateFields = true) {
        this.setBoundarySelection([]);
        this.updateBoundaryLayerStyles();
        this.updateSelectedBoundaryList();
        if (updateFields) this.applyBoundarySelectionToFields();
    },

    updateBoundaryLayerStyles() {
        if (!this.boundaryLayerGroup) return;
        this.boundaryLayerGroup.eachLayer(layer => {
            layer.eachLayer?.(itemLayer => {
                if (itemLayer.feature && itemLayer.setStyle) {
                    itemLayer.setStyle(this.getBoundaryStyle(itemLayer.feature));
                }
            });
        });
    },

    updateSelectedBoundaryList() {
        const container = document.getElementById('selected-boundary-list');
        if (!container) return;
        const selected = this.getBoundarySelection();

        if (!selected.length) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        container.classList.remove('hidden');
        container.innerHTML = `
            <div class="boundary-selection-title">
                <i class="fa-solid fa-draw-polygon text-chula"></i>
                เลือกแล้ว ${selected.length} พื้นที่
            </div>
            <div class="boundary-selection-chips">
                ${selected.map(item => `
                    <span class="boundary-chip">
                        <span>${this.escapeHTML(item.levelLabel || this.getBoundaryLevelLabel(item.adminLevel))}: ${this.escapeHTML(item.name)}</span>
                        <button type="button" onclick="appState.removeBoundarySelection('${this.escapeHTML(item.id)}')" aria-label="ลบ ${this.escapeHTML(item.name)}">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    </span>
                `).join('')}
            </div>
        `;
    },

    getAggregateBounds(items) {
        const bounds = items.map(item => item.bounds).filter(Boolean);
        if (!bounds.length) return null;
        return {
            south: Math.min(...bounds.map(item => Number(item.south))),
            north: Math.max(...bounds.map(item => Number(item.north))),
            west: Math.min(...bounds.map(item => Number(item.west))),
            east: Math.max(...bounds.map(item => Number(item.east)))
        };
    },

    applyBoundarySelectionToFields() {
        const selected = this.getBoundarySelection();
        const typeInput = document.getElementById('m_location_type');

        if (!selected.length) {
            if (typeInput) typeInput.value = this.mapSelectionMode;
            ['m_area', 'm_lat', 'm_lng', 'm_place_name', 'm_osm_id', 'm_bounds_south', 'm_bounds_north', 'm_bounds_west', 'm_bounds_east'].forEach(id => {
                const element = document.getElementById(id);
                if (element) element.value = '';
            });
            this.updateAreaLocationUI();
            this.setAreaMapStatus('ยังไม่ได้เลือก boundary คลิก shape เพื่อเลือกตำบล/อำเภอได้มากกว่า 1 พื้นที่');
            return;
        }

        const names = selected.map(item => item.name).join(', ');
        const bounds = this.getAggregateBounds(selected);
        if (!bounds) return;

        if (this.areaMarker && this.areaMap) {
            this.areaMap.removeLayer(this.areaMarker);
            this.areaMarker = null;
        }
        if (this.areaRectangle && this.areaMap) {
            this.areaMap.removeLayer(this.areaRectangle);
            this.areaRectangle = null;
        }

        const areaInput = document.getElementById('m_area');
        const latInput = document.getElementById('m_lat');
        const lngInput = document.getElementById('m_lng');
        const placeInput = document.getElementById('m_place_name');
        const labelInput = document.getElementById('m_location_label');
        const osmIdInput = document.getElementById('m_osm_id');
        const centerLat = (bounds.south + bounds.north) / 2;
        const centerLng = (bounds.west + bounds.east) / 2;

        if (areaInput) areaInput.value = names;
        if (latInput) latInput.value = centerLat.toFixed(6);
        if (lngInput) lngInput.value = centerLng.toFixed(6);
        if (placeInput) placeInput.value = names;
        if (labelInput && !labelInput.value.trim()) labelInput.value = names;
        if (osmIdInput) osmIdInput.value = selected.map(item => item.osmId).filter(Boolean).join(',');
        if (typeInput) typeInput.value = 'boundary';
        this.setBoundsFields(bounds);
        this.setMapSelectionMode('boundary', false);
        this.updateAreaLocationUI();
        this.setAreaMapStatus(`เลือก boundary แล้ว ${selected.length} พื้นที่ คลิกซ้ำเพื่อยกเลิก`);
    },

    syncBoundarySelectionFromFields() {
        const selected = this.getBoundarySelection();
        this.selectedBoundaryIds = new Set(selected.map(item => item.id));
        this.updateSelectedBoundaryList();
    },

    getGeocodeCacheKey(query) {
        return `osm-search:${query.trim().toLowerCase()}`;
    },

    async searchAreaLocation() {
        const query = this.getValue('m_area').trim();
        if (!query) {
            this.setAreaMapStatus('กรอกชื่อพื้นที่ก่อนค้นหา');
            return;
        }

        const cached = localStorage.getItem(this.getGeocodeCacheKey(query));
        if (cached) {
            try {
                this.areaSearchResults = JSON.parse(cached);
                this.renderAreaSearchResults(this.areaSearchResults);
                this.setAreaMapStatus(`พบ ${this.areaSearchResults.length} ผลลัพธ์จาก cache`);
                return;
            } catch (error) {
                console.warn('Could not parse cached OSM result', error);
            }
        }

        const waitMs = Math.max(0, 1000 - (Date.now() - this.lastGeocodeAt));
        if (waitMs > 0) await new Promise(resolve => window.setTimeout(resolve, waitMs));

        this.setAreaMapStatus('กำลังค้นหาจาก OpenStreetMap...');
        this.lastGeocodeAt = Date.now();

        try {
            const params = new URLSearchParams({
                format: 'jsonv2',
                q: query,
                limit: '5',
                'accept-language': 'th,en',
                addressdetails: '1'
            });
            const response = await fetch(`${OSM_SEARCH_ENDPOINT}?${params.toString()}`, {
                headers: { Accept: 'application/json' }
            });
            if (!response.ok) throw new Error(`OSM search failed: ${response.status}`);
            const results = await response.json();
            this.areaSearchResults = Array.isArray(results) ? results : [];
            localStorage.setItem(this.getGeocodeCacheKey(query), JSON.stringify(this.areaSearchResults));
            this.renderAreaSearchResults(this.areaSearchResults);
            this.setAreaMapStatus(this.areaSearchResults.length ? `พบ ${this.areaSearchResults.length} ตำแหน่ง เลือกหนึ่งรายการด้านล่าง` : 'ไม่พบตำแหน่ง ลองค้นหาด้วยชื่อพื้นที่ที่เฉพาะเจาะจงขึ้น');
        } catch (error) {
            console.warn(error);
            this.setAreaMapStatus('ค้นหาแผนที่ไม่สำเร็จ ลองใหม่อีกครั้งหรือคลิกปักหมุดเองบนแผนที่');
        }
    },

    renderAreaSearchResults(results) {
        const container = document.getElementById('area-search-results');
        if (!container) return;

        if (!results.length) {
            container.classList.add('hidden');
            container.innerHTML = '';
            return;
        }

        container.classList.remove('hidden');
        container.innerHTML = results.map((result, index) => `
            <div class="map-result">
                <span class="font-semibold text-gray-900">${this.escapeHTML(result.name || result.display_name)}</span>
                <span class="text-xs text-gray-500">${this.escapeHTML(result.display_name)}</span>
                <div class="map-result-actions">
                    <button type="button" onclick="appState.selectAreaSearchResult(${index}, 'pin')">
                        <i class="fa-solid fa-location-dot mr-1"></i>เลือกเป็นจุด
                    </button>
                    ${this.parseBounds(result.boundingbox) ? `<button type="button" onclick="appState.selectAreaSearchResult(${index}, 'area')"><i class="fa-solid fa-vector-square mr-1"></i>ใช้ขอบเขตพื้นที่นี้</button>` : ''}
                </div>
            </div>
        `).join('');
    },

    selectAreaSearchResult(index, type = 'pin') {
        const result = this.areaSearchResults[index];
        if (!result) return;
        const bounds = this.parseBounds(result.boundingbox);

        if (type === 'area' && bounds) {
            this.setProjectArea({
                bounds,
                displayName: result.display_name,
                label: result.name || result.display_name,
                osmId: result.osm_id
            });
            const resultsEl = document.getElementById('area-search-results');
            if (resultsEl) resultsEl.classList.add('hidden');
            return;
        }

        this.setProjectLocation({
            lat: result.lat,
            lng: result.lon,
            displayName: result.display_name,
            label: result.name || result.display_name,
            osmId: result.osm_id,
            boundingbox: result.boundingbox
        });

        const resultsEl = document.getElementById('area-search-results');
        if (resultsEl) resultsEl.classList.add('hidden');
    },

    setProjectLocation(location) {
        const lat = Number(location.lat);
        const lng = Number(location.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

        const displayName = location.displayName || `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        const areaInput = document.getElementById('m_area');
        const latInput = document.getElementById('m_lat');
        const lngInput = document.getElementById('m_lng');
        const placeInput = document.getElementById('m_place_name');
        const osmIdInput = document.getElementById('m_osm_id');
        const labelInput = document.getElementById('m_location_label');
        const typeInput = document.getElementById('m_location_type');

        if (areaInput) areaInput.value = displayName;
        if (latInput) latInput.value = lat.toFixed(6);
        if (lngInput) lngInput.value = lng.toFixed(6);
        if (placeInput) placeInput.value = displayName;
        if (osmIdInput) osmIdInput.value = location.osmId || '';
        if (labelInput && !labelInput.value.trim()) labelInput.value = location.label || displayName;
        if (typeInput) typeInput.value = 'pin';
        this.setMapSelectionMode('pin', false);
        this.clearBoundarySelection(false);
        this.clearAreaBounds(false);

        this.setAreaMarker(lat, lng, this.getSelectedLocationLabel(displayName), location.boundingbox);
        this.updateAreaLocationUI();
        this.setAreaMapStatus('เลือกตำแหน่งแบบปักหมุดแล้ว สามารถแก้ชื่อที่จะแสดงในรายงานได้');
        this.scheduleSave();
        this.updateLiveSummary();
    },

    setProjectArea(area) {
        const bounds = area.bounds;
        if (!bounds || ![bounds.south, bounds.north, bounds.west, bounds.east].every(Number.isFinite)) return;

        const centerLat = (bounds.south + bounds.north) / 2;
        const centerLng = (bounds.west + bounds.east) / 2;
        const displayName = area.displayName || 'พื้นที่โครงการ';
        const areaInput = document.getElementById('m_area');
        const latInput = document.getElementById('m_lat');
        const lngInput = document.getElementById('m_lng');
        const placeInput = document.getElementById('m_place_name');
        const osmIdInput = document.getElementById('m_osm_id');
        const labelInput = document.getElementById('m_location_label');
        const typeInput = document.getElementById('m_location_type');

        if (areaInput) areaInput.value = displayName;
        if (latInput) latInput.value = centerLat.toFixed(6);
        if (lngInput) lngInput.value = centerLng.toFixed(6);
        if (placeInput) placeInput.value = displayName;
        if (osmIdInput) osmIdInput.value = area.osmId || '';
        if (labelInput && !labelInput.value.trim()) labelInput.value = area.label || displayName;
        if (typeInput) typeInput.value = 'area';
        this.setMapSelectionMode('area', false);
        this.clearBoundarySelection(false);
        this.setBoundsFields(bounds);
        this.setAreaRectangle(bounds, this.getSelectedLocationLabel(displayName));
        this.updateAreaLocationUI();
        this.setAreaMapStatus('เลือกขอบเขตพื้นที่แล้ว สามารถแก้ชื่อที่จะแสดงในรายงานได้');
        this.scheduleSave();
        this.updateLiveSummary();
    },

    setBoundsFields(bounds) {
        const fieldMap = {
            m_bounds_south: bounds.south,
            m_bounds_north: bounds.north,
            m_bounds_west: bounds.west,
            m_bounds_east: bounds.east
        };
        Object.entries(fieldMap).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.value = Number(value).toFixed(6);
        });
    },

    clearAreaBounds(updateUI = true) {
        ['m_bounds_south', 'm_bounds_north', 'm_bounds_west', 'm_bounds_east'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = '';
        });
        if (this.areaRectangle && this.areaMap) {
            this.areaMap.removeLayer(this.areaRectangle);
            this.areaRectangle = null;
        }
        if (updateUI) this.updateAreaLocationUI();
    },

    getSelectedLocationLabel(fallback = 'ตำแหน่งโครงการ') {
        return this.getValue('m_location_label').trim()
            || this.getValue('m_place_name').trim()
            || this.getValue('m_area').trim()
            || fallback;
    },

    refreshSelectedLocationLabel() {
        const lat = this.parseNumberValue(this.getValue('m_lat'));
        const lng = this.parseNumberValue(this.getValue('m_lng'));
        const label = this.getSelectedLocationLabel();
        const bounds = this.getBoundsFromFields();
        const type = this.getValue('m_location_type') || 'pin';

        if (type === 'area' && bounds && this.areaRectangle) {
            this.areaRectangle.bindPopup(this.escapeHTML(label));
        } else if (lat && lng && this.areaMarker) {
            this.areaMarker.bindPopup(this.escapeHTML(label));
        }
        this.updateAreaLocationUI();
    },

    setAreaMarker(lat, lng, label, boundingbox = null) {
        if (!this.areaMap || !window.L) return;

        if (this.areaRectangle) {
            this.areaMap.removeLayer(this.areaRectangle);
            this.areaRectangle = null;
        }

        if (!this.areaMarker) {
            this.areaMarker = window.L.marker([lat, lng], { draggable: true }).addTo(this.areaMap);
            this.areaMarker.on('dragend', () => {
                const position = this.areaMarker.getLatLng();
                this.setProjectLocation({
                    lat: position.lat,
                    lng: position.lng,
                    displayName: 'ตำแหน่งที่เลื่อนหมุดเอง',
                    label: this.getValue('m_location_label') || 'ตำแหน่งที่เลื่อนหมุดเอง'
                });
            });
        } else {
            this.areaMarker.setLatLng([lat, lng]);
        }

        this.areaMarker.bindPopup(this.escapeHTML(label)).openPopup();

        if (Array.isArray(boundingbox) && boundingbox.length === 4) {
            const [south, north, west, east] = boundingbox.map(Number);
            if ([south, north, west, east].every(Number.isFinite)) {
                this.areaMap.fitBounds([[south, west], [north, east]], { padding: [24, 24], maxZoom: 16 });
                return;
            }
        }

        this.areaMap.setView([lat, lng], 15);
    },

    setAreaRectangle(bounds, label, fitMap = true, keepClosed = false) {
        if (!this.areaMap || !window.L) return;

        if (this.areaMarker) {
            this.areaMap.removeLayer(this.areaMarker);
            this.areaMarker = null;
        }

        const latLngBounds = [[bounds.south, bounds.west], [bounds.north, bounds.east]];
        if (!this.areaRectangle) {
            this.areaRectangle = window.L.rectangle(latLngBounds, {
                color: '#de5f8b',
                weight: 2,
                fillColor: '#de5f8b',
                fillOpacity: 0.16
            }).addTo(this.areaMap);
        } else {
            this.areaRectangle.setBounds(latLngBounds);
        }

        this.areaRectangle.bindPopup(this.escapeHTML(label || 'พื้นที่โครงการ'));
        if (!keepClosed) this.areaRectangle.openPopup();
        if (fitMap) this.areaMap.fitBounds(latLngBounds, { padding: [24, 24], maxZoom: 16 });
    },

    syncAreaMarkerFromFields() {
        const lat = this.parseNumberValue(this.getValue('m_lat'));
        const lng = this.parseNumberValue(this.getValue('m_lng'));
        const label = this.getSelectedLocationLabel();
        const bounds = this.getBoundsFromFields();
        const type = this.getValue('m_location_type') || (bounds ? 'area' : 'pin');

        if (type === 'boundary') {
            this.setMapSelectionMode('boundary', false);
            this.syncBoundarySelectionFromFields();
            const selected = this.getBoundarySelection();
            if (selected.length) this.renderBoundaryLayers([], { clear: true, fitSelected: true });
        } else if (lat && lng && type === 'area' && bounds) {
            this.setMapSelectionMode('area', false);
            this.setAreaRectangle(bounds, label);
        } else if (lat && lng) {
            this.setMapSelectionMode('pin', false);
            this.setAreaMarker(lat, lng, label || 'ตำแหน่งโครงการ');
        }
        this.updateAreaLocationUI();
    },

    updateAreaLocationUI() {
        const container = document.getElementById('selected-area-location');
        if (!container) return;
        const lat = this.getValue('m_lat');
        const lng = this.getValue('m_lng');
        const place = this.getValue('m_place_name') || this.getValue('m_area');
        const label = this.getSelectedLocationLabel();
        const type = this.getValue('m_location_type') || 'pin';
        const bounds = this.getBoundsFromFields();

        const selectedBoundaries = this.getBoundarySelection();
        if (type === 'boundary' && selectedBoundaries.length) {
            container.innerHTML = `
                <div>
                    <p class="font-semibold text-gray-900">${this.escapeHTML(label || `${selectedBoundaries.length} พื้นที่`)}</p>
                    <p class="text-xs text-gray-500">ขอบเขตตำบล/อำเภอ · เลือก ${selectedBoundaries.length} พื้นที่</p>
                    <p class="text-xs text-gray-500">${this.escapeHTML(selectedBoundaries.map(item => item.name).join(', '))}</p>
                    ${bounds ? `<p class="text-xs text-gray-500">SW ${bounds.south.toFixed(4)}, ${bounds.west.toFixed(4)} · NE ${bounds.north.toFixed(4)}, ${bounds.east.toFixed(4)}</p>` : ''}
                </div>
                ${lat && lng ? `<a href="${this.getOSMLink(lat, lng)}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-chula hover:underline">เปิดใน OSM</a>` : ''}
            `;
            return;
        }

        if (!lat || !lng) {
            container.innerHTML = '<i class="fa-solid fa-circle-info mr-1"></i>ยังไม่ได้เลือกตำแหน่ง';
            return;
        }

        container.innerHTML = `
            <div>
                <p class="font-semibold text-gray-900">${this.escapeHTML(label || 'ตำแหน่งโครงการ')}</p>
                <p class="text-xs text-gray-500">${type === 'area' ? 'ขอบเขตพื้นที่' : 'ปักหมุด'} · Lat ${this.escapeHTML(lat)}, Lng ${this.escapeHTML(lng)}</p>
                ${place && place !== label ? `<p class="text-xs text-gray-500">${this.escapeHTML(place)}</p>` : ''}
                ${type === 'area' && bounds ? `<p class="text-xs text-gray-500">SW ${bounds.south.toFixed(4)}, ${bounds.west.toFixed(4)} · NE ${bounds.north.toFixed(4)}, ${bounds.east.toFixed(4)}</p>` : ''}
            </div>
            <a href="${this.getOSMLink(lat, lng)}" target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-chula hover:underline">เปิดใน OSM</a>
        `;
    },

    clearAreaLocation() {
        ['m_lat', 'm_lng', 'm_place_name', 'm_osm_id', 'm_location_label', 'm_bounds_south', 'm_bounds_north', 'm_bounds_west', 'm_bounds_east', 'm_boundary_selection_json'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.value = id === 'm_boundary_selection_json' ? '[]' : '';
        });
        this.selectedBoundaryIds = new Set();
        this.updateBoundaryLayerStyles();
        this.updateSelectedBoundaryList();
        const typeInput = document.getElementById('m_location_type');
        if (typeInput) typeInput.value = this.mapSelectionMode;
        if (this.areaMarker && this.areaMap) {
            this.areaMap.removeLayer(this.areaMarker);
            this.areaMarker = null;
        }
        if (this.areaRectangle && this.areaMap) {
            this.areaMap.removeLayer(this.areaRectangle);
            this.areaRectangle = null;
        }
        if (this.areaMap) this.areaMap.setView(OSM_DEFAULT_CENTER, OSM_DEFAULT_ZOOM);
        this.areaDragStart = null;
        this.isDrawingArea = false;
        this.updateAreaLocationUI();
        this.setAreaMapStatus(this.mapSelectionMode === 'area'
            ? 'โหมดกำหนดพื้นที่: ลากบนแผนที่เพื่อคลุมพื้นที่ดำเนินงาน'
            : 'โหมดปักหมุด: คลิกบนแผนที่เพื่อเลือกตำแหน่งโครงการ');
        this.scheduleSave();
    },

    getOSMLink(lat, lng) {
        return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lng)}#map=15/${encodeURIComponent(lat)}/${encodeURIComponent(lng)}`;
    },

    createActivityImage(overrides = {}) {
        const legacyCrop = this.getLegacyCropPercent(overrides.cropPosition);
        return {
            src: overrides.src || '',
            name: overrides.name || '',
            size: overrides.size || 0,
            width: overrides.width || 0,
            height: overrides.height || 0,
            cropPosition: overrides.cropPosition || 'custom',
            cropX: this.clampCropValue(overrides.cropX ?? legacyCrop.x),
            cropY: this.clampCropValue(overrides.cropY ?? legacyCrop.y)
        };
    },

    normaliseActivityImages(images = []) {
        return Array.from({ length: 6 }, (_, index) => this.createActivityImage(images[index] || {}));
    },

    renderActivityPhotoSlots() {
        const container = document.getElementById('activity-photo-grid');
        if (!container) return;

        this.activityImages = this.normaliseActivityImages(this.activityImages);
        container.innerHTML = this.activityImages.map((image, index) => {
            const hasImage = Boolean(image.src);
            const crop = this.getActivityCropPercent(image);
            return `
                <div class="activity-photo-slot ${hasImage ? 'activity-photo-slot-filled' : ''}" data-photo-slot="${index}">
                    <input type="file" id="sv_photo_${index + 1}" accept="image/*" class="sr-only" onchange="appState.handleActivityPhotoUpload(event, ${index})">
                    ${hasImage
                        ? `<div class="activity-photo-frame activity-photo-crop-frame" onpointerdown="appState.startActivityCropDrag(event, ${index})" role="group" aria-label="จัดตำแหน่งครอปภาพกิจกรรม ${index + 1}">
                            <img src="${this.escapeHTML(image.src)}" alt="ภาพกิจกรรม ${index + 1}" draggable="false" style="object-position:${this.getCropObjectPosition(image)}">
                            <span class="activity-crop-focus" style="left:${crop.x}%; top:${crop.y}%"></span>
                        </div>`
                        : `<label class="activity-photo-frame" for="sv_photo_${index + 1}">
                            <div class="activity-photo-placeholder">
                                <i class="fa-solid fa-image"></i>
                                <span>รูปที่ ${index + 1}</span>
                                <small>3:2 แนวนอน</small>
                            </div>
                        </label>`
                    }
                    <div class="activity-photo-meta">
                        <div class="min-w-0">
                            <p class="activity-photo-title">${hasImage ? this.escapeHTML(image.name || `ภาพกิจกรรม ${index + 1}`) : `ภาพกิจกรรม ${index + 1}`}</p>
                            <p class="activity-photo-detail">${hasImage ? this.getActivityImageDetail(image) : 'แนะนำ 1200×800px ขึ้นไป'}</p>
                        </div>
                        ${hasImage
                            ? `<div class="activity-photo-actions">
                                <label class="activity-photo-action" for="sv_photo_${index + 1}" aria-label="เปลี่ยนภาพกิจกรรม ${index + 1}">
                                    <i class="fa-solid fa-arrow-rotate-right"></i>
                                </label>
                                <button type="button" class="activity-photo-remove" onclick="appState.removeActivityPhoto(${index})" aria-label="ลบภาพกิจกรรม ${index + 1}">
                                    <i class="fa-solid fa-trash-can"></i>
                                </button>
                            </div>`
                            : ''
                        }
                    </div>
                    <div class="activity-photo-crop ${hasImage ? '' : 'hidden'}">
                        <div class="activity-photo-crop-label">
                            <i class="fa-solid fa-crop-simple"></i>
                            <span>ตำแหน่งครอป</span>
                        </div>
                        <label class="activity-photo-slider">
                            <span>แนวนอน</span>
                            <input type="range" id="sv_photo_crop_x_${index + 1}" min="0" max="100" value="${crop.x}" oninput="appState.updateActivityPhotoCrop(${index}, 'x', this.value)" onchange="appState.scheduleSave()">
                        </label>
                        <label class="activity-photo-slider">
                            <span>แนวตั้ง</span>
                            <input type="range" id="sv_photo_crop_y_${index + 1}" min="0" max="100" value="${crop.y}" oninput="appState.updateActivityPhotoCrop(${index}, 'y', this.value)" onchange="appState.scheduleSave()">
                        </label>
                    </div>
                </div>
            `;
        }).join('');
        this.updateActivityPhotoCount();
    },

    getLegacyCropPercent(position) {
        return {
            top: { x: 50, y: 0 },
            bottom: { x: 50, y: 100 },
            left: { x: 0, y: 50 },
            right: { x: 100, y: 50 },
            center: { x: 50, y: 50 },
            custom: { x: 50, y: 50 }
        }[position] || { x: 50, y: 50 };
    },

    clampCropValue(value, fallback = 50) {
        const number = Number.parseFloat(value);
        if (!Number.isFinite(number)) return fallback;
        return Math.min(100, Math.max(0, Math.round(number)));
    },

    getActivityCropPercent(image = {}) {
        const legacyCrop = this.getLegacyCropPercent(image.cropPosition);
        return {
            x: this.clampCropValue(image.cropX ?? legacyCrop.x),
            y: this.clampCropValue(image.cropY ?? legacyCrop.y)
        };
    },

    getCropObjectPosition(image) {
        const crop = typeof image === 'string'
            ? this.getLegacyCropPercent(image)
            : this.getActivityCropPercent(image);
        return `${crop.x}% ${crop.y}%`;
    },

    updateActivityCropUI(index) {
        const image = this.activityImages[index];
        if (!image?.src) return;

        const crop = this.getActivityCropPercent(image);
        const slot = document.querySelector(`[data-photo-slot="${index}"]`);
        slot?.querySelector('.activity-photo-crop-frame img')?.style.setProperty('object-position', `${crop.x}% ${crop.y}%`);
        const focus = slot?.querySelector('.activity-crop-focus');
        if (focus) {
            focus.style.left = `${crop.x}%`;
            focus.style.top = `${crop.y}%`;
        }

        const xSlider = document.getElementById(`sv_photo_crop_x_${index + 1}`);
        const ySlider = document.getElementById(`sv_photo_crop_y_${index + 1}`);
        if (xSlider) xSlider.value = crop.x;
        if (ySlider) ySlider.value = crop.y;
    },

    setActivityPhotoCrop(index, cropX, cropY, shouldSave = true) {
        if (this.isViewMode) return;
        this.activityImages = this.normaliseActivityImages(this.activityImages);
        if (!this.activityImages[index]?.src) return;

        this.activityImages[index].cropX = this.clampCropValue(cropX, this.activityImages[index].cropX);
        this.activityImages[index].cropY = this.clampCropValue(cropY, this.activityImages[index].cropY);
        this.activityImages[index].cropPosition = 'custom';
        this.updateActivityCropUI(index);
        if (shouldSave) this.scheduleSave();
    },

    startActivityCropDrag(event, index) {
        if (this.isViewMode || event.pointerType === 'mouse' && event.button !== 0) return;

        const frame = event.currentTarget;
        const moveCrop = pointerEvent => {
            const rect = frame.getBoundingClientRect();
            const x = ((pointerEvent.clientX - rect.left) / rect.width) * 100;
            const y = ((pointerEvent.clientY - rect.top) / rect.height) * 100;
            this.setActivityPhotoCrop(index, x, y, false);
        };

        event.preventDefault();
        frame.setPointerCapture?.(event.pointerId);
        frame.classList.add('activity-photo-crop-frame-active');
        moveCrop(event);

        const finish = () => {
            frame.classList.remove('activity-photo-crop-frame-active');
            frame.releasePointerCapture?.(event.pointerId);
            frame.removeEventListener('pointermove', moveCrop);
            frame.removeEventListener('pointerup', finish);
            frame.removeEventListener('pointercancel', finish);
            this.scheduleSave();
        };

        frame.addEventListener('pointermove', moveCrop);
        frame.addEventListener('pointerup', finish);
        frame.addEventListener('pointercancel', finish);
    },

    getActivityImageDetail(image) {
        const sizeKb = image.size ? `${Math.round(image.size / 1024).toLocaleString()} KB` : '';
        const dimensions = image.width && image.height ? `${image.width}×${image.height}px` : '';
        const ratioWarning = image.width && image.height && Math.abs((image.width / image.height) - 1.5) > 0.08
            ? ' · จะถูกครอปเข้า 3:2'
            : '';
        return [dimensions, sizeKb].filter(Boolean).join(' · ') + ratioWarning;
    },

    updateActivityPhotoCount() {
        const counter = document.getElementById('activity-photo-count');
        if (!counter) return;
        const count = this.activityImages.filter(image => image.src).length;
        counter.textContent = `${count}/6 รูป`;
        counter.classList.toggle('activity-photo-count-complete', count === 6);
    },

    handleActivityPhotoUpload(event, index) {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            const src = String(reader.result || '');
            const probe = new Image();
            probe.onload = () => {
                this.activityImages = this.normaliseActivityImages(this.activityImages);
                this.activityImages[index] = this.createActivityImage({
                    src,
                    name: file.name,
                    size: file.size,
                    width: probe.naturalWidth,
                    height: probe.naturalHeight,
                    cropPosition: 'custom',
                    cropX: 50,
                    cropY: 50
                });
                this.uploadedImage = this.activityImages.find(image => image.src)?.src || null;
                this.renderActivityPhotoSlots();
                this.scheduleSave();
                this.updateLiveSummary();
            };
            probe.src = src;
        };
        reader.readAsDataURL(file);
        event.target.value = '';
    },

    removeActivityPhoto(index) {
        if (this.isViewMode) return;
        this.activityImages = this.normaliseActivityImages(this.activityImages);
        this.activityImages[index] = this.createActivityImage();
        this.uploadedImage = this.activityImages.find(image => image.src)?.src || null;
        this.renderActivityPhotoSlots();
        this.scheduleSave();
    },

    updateActivityPhotoCrop(index, axis, value) {
        if (this.isViewMode) return;
        this.activityImages = this.normaliseActivityImages(this.activityImages);
        if (!this.activityImages[index]?.src) return;

        if (axis === 'x') {
            this.setActivityPhotoCrop(index, value, this.activityImages[index].cropY, false);
            return;
        }
        if (axis === 'y') {
            this.setActivityPhotoCrop(index, this.activityImages[index].cropX, value, false);
            return;
        }

        const crop = this.getLegacyCropPercent(axis);
        this.setActivityPhotoCrop(index, crop.x, crop.y);
    },

    previewImage(event) {
        const file = event.target.files[0];
        if (file) {
            this.handleActivityPhotoUpload(event, 0);
        }
    },

    filterSDGs() {
        const query = this.getValue('sdg-search').trim().toLowerCase();
        document.querySelectorAll('[data-sdg-card]').forEach(card => {
            const checked = card.querySelector('.sdg-checkbox')?.checked;
            const matches = card.dataset.search.includes(query);
            card.classList.toggle('hidden', Boolean(query) && !matches && !checked);
        });
    },

    handleSDGChange() {
        this.updateSelectedSDGs();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    getSDGTargetsState() {
        const hidden = document.getElementById('sdg_targets_json');
        if (!hidden?.value) return {};

        try {
            const parsed = JSON.parse(hidden.value);
            if (!parsed || typeof parsed !== 'object') return {};
            return Object.fromEntries(Object.entries(parsed).map(([sdgId, targets]) => [
                sdgId,
                Array.isArray(targets) ? targets.filter(Boolean) : []
            ]));
        } catch (error) {
            console.warn('Could not parse SDG targets', error);
            return {};
        }
    },

    setSDGTargetsState(targetsBySDG) {
        const hidden = document.getElementById('sdg_targets_json');
        if (!hidden) return;
        hidden.value = JSON.stringify(targetsBySDG ?? {});
    },

    collectVisibleSDGTargets(fallback = {}) {
        const targetsBySDG = { ...fallback };
        document.querySelectorAll('.sdg-target-checkbox').forEach(input => {
            const sdgId = input.dataset.sdgId;
            if (!sdgId) return;
            if (!targetsBySDG[sdgId]) targetsBySDG[sdgId] = [];
            if (input.checked && !targetsBySDG[sdgId].includes(input.value)) {
                targetsBySDG[sdgId].push(input.value);
            }
        });
        return targetsBySDG;
    },

    filterSDGTargetsToSelected(targetsBySDG, selectedIds) {
        const selectedSet = new Set(selectedIds.map(String));
        return Object.fromEntries(Object.entries(targetsBySDG ?? {})
            .filter(([sdgId]) => selectedSet.has(String(sdgId)))
            .map(([sdgId, targets]) => [sdgId, Array.from(new Set(targets ?? []))]));
    },

    updateSDGTargetsHidden() {
        const selectedIds = Array.from(document.querySelectorAll('.sdg-checkbox:checked'), cb => cb.dataset.sdgId);
        const targetsBySDG = this.filterSDGTargetsToSelected(this.collectVisibleSDGTargets({}), selectedIds);
        this.setSDGTargetsState(targetsBySDG);
        this.updateSDGTargetCounts();
    },

    updateSDGTargetCounts() {
        const targetsBySDG = this.getSDGTargetsState();
        document.querySelectorAll('[data-sdg-target-count]').forEach(el => {
            const count = targetsBySDG[el.dataset.sdgId]?.length ?? 0;
            el.textContent = count ? `${count} selected` : 'optional';
        });
    },

    renderSDGTargetOptions(sdg, selectedTargets) {
        const targets = SDG_TARGETS[sdg.id] ?? [];
        if (targets.length === 0) return '';

        const targetList = targets.map(target => {
            const checked = selectedTargets.has(target.code) ? 'checked' : '';
            return `
                <label class="sdg-target-option">
                    <input type="checkbox" class="sdg-target-checkbox" data-sdg-id="${sdg.id}" value="${this.escapeHTML(target.code)}" ${checked}>
                    <span>
                        <strong>${this.escapeHTML(target.code)}</strong>
                        ${this.escapeHTML(target.title)}
                    </span>
                </label>
            `;
        }).join('');

        return `
            <details class="sdg-target-details" open>
                <summary>
                    <span>หัวข้อย่อย SDG ${sdg.id}</span>
                    <span class="sdg-target-count" data-sdg-target-count data-sdg-id="${sdg.id}">${selectedTargets.size ? `${selectedTargets.size} selected` : 'optional'}</span>
                </summary>
                <div class="sdg-target-list">${targetList}</div>
            </details>
        `;
    },

    updateSelectedSDGs() {
        const container = document.getElementById('selected-sdgs');
        if (!container) return;
        const existingNotes = {};
        document.querySelectorAll('.sdg-reason').forEach(note => {
            existingNotes[note.dataset.sdgId] = note.value;
        });

        const selectedIds = Array.from(document.querySelectorAll('.sdg-checkbox:checked'), cb => cb.dataset.sdgId);
        const existingTargets = this.filterSDGTargetsToSelected(
            this.collectVisibleSDGTargets(this.getSDGTargetsState()),
            selectedIds
        );
        this.setSDGTargetsState(existingTargets);

        const selected = Array.from(document.querySelectorAll('.sdg-checkbox:checked')).map(cb => {
            const sdgId = cb.dataset.sdgId;
            const sdg = SDGs_LIST.find(item => String(item.id) === sdgId);
            return {
                ...sdg,
                value: cb.value,
                note: existingNotes[sdgId] || '',
                targets: new Set(existingTargets[sdgId] ?? [])
            };
        });

        if (selected.length === 0) {
            this.setSDGTargetsState({});
            container.innerHTML = '<p class="text-sm text-gray-500 italic">ยังไม่ได้เลือก SDGs</p>';
            return;
        }

        container.innerHTML = selected.map(sdg => `
            <div class="border border-chula-light bg-white rounded-lg p-3">
                <div class="flex items-start gap-2 mb-2">
                    <span class="w-7 h-7 rounded-full bg-chula text-white flex items-center justify-center text-xs font-bold flex-shrink-0">${sdg.id}</span>
                    <div>
                        <p class="text-sm font-semibold text-gray-900">SDG ${sdg.id}: ${this.escapeHTML(sdg.title)}</p>
                        <p class="text-xs text-gray-500">${this.escapeHTML(sdg.focus)}</p>
                    </div>
                </div>
                <label class="form-label">เหตุผลที่เกี่ยวข้องกับโครงการนี้</label>
                <textarea rows="2" class="form-control resize-none sdg-reason" data-sdg-id="${sdg.id}" placeholder="ระบุเหตุผลสั้น ๆ ว่า SDG นี้เกี่ยวข้องอย่างไร">${this.escapeHTML(sdg.note)}</textarea>
                ${this.renderSDGTargetOptions(sdg, sdg.targets)}
            </div>
        `).join('');
        this.updateSDGTargetCounts();
    },

    createSROIRow(overrides = {}) {
        return {
            id: overrides.id || `sroi_${Date.now()}_${Math.random().toString(16).slice(2)}`,
            stakeholderGroup: overrides.stakeholderGroup || '',
            groupSize: overrides.groupSize ?? 0,
            inputDescription: overrides.inputDescription || '',
            outputSummary: overrides.outputSummary || '',
            investment: overrides.investment ?? 0,
            quantity: overrides.quantity ?? 0,
            monetaryValue: overrides.monetaryValue ?? 0,
            changeDepth: overrides.changeDepth || '',
            weighting: overrides.weighting || '',
            outcomeDescription: overrides.outcomeDescription || '',
            duration: overrides.duration ?? 1,
            outcomeStart: overrides.outcomeStart || 'period-activity',
            discountRate: overrides.discountRate ?? 3.5,
            deadweight: overrides.deadweight ?? 0,
            displacement: overrides.displacement ?? 0,
            attribution: overrides.attribution ?? 0,
            dropoff: overrides.dropoff ?? 0,
            valuationApproach: overrides.valuationApproach || '',
            indicatorSource: overrides.indicatorSource || ''
        };
    },

    renderSROIRows() {
        const container = document.getElementById('sroi-rows-container');
        if (!container) return;
        if (this.sroiRows.length === 0) {
            this.sroiRows = [this.createSROIRow()];
        }

        container.innerHTML = this.sroiRows.map((row, index) => {
            const result = this.calculateSROIRow(row);
            const title = row.outcomeDescription || row.stakeholderGroup || `Outcome row ${index + 1}`;
            return `
                <details class="form-panel bg-white sroi-row" ${index === 0 ? 'open' : ''}>
                    <summary class="cursor-pointer list-none">
                        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                            <div>
                                <p class="font-bold text-gray-900"><i class="fa-solid fa-table-list text-chula mr-2"></i>${this.escapeHTML(title)}</p>
                                <p class="text-xs text-gray-500">PV ${this.formatMoney(result.totalPV)} บาท · Investment ${this.formatMoney(result.investment)} บาท</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-semibold bg-chula bg-opacity-10 text-chula-darker px-3 py-1 rounded-full">1 : ${result.sroiRatio.toFixed(2)}</span>
                                ${this.sroiRows.length > 1 ? `<button type="button" onclick="event.preventDefault(); appState.removeSROIRow('${row.id}')" class="text-xs text-red-600 hover:text-red-800 px-2 py-1"><i class="fa-solid fa-trash-can mr-1"></i>ลบ</button>` : ''}
                            </div>
                        </div>
                    </summary>
                    <div class="mt-4 space-y-5">
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-users text-chula mr-2"></i>Stage 1: Stakeholders</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                ${this.rowInput(row, 'stakeholderGroup', 'กลุ่มผู้ได้รับผลกระทบ', 'text', 'เช่น สมาชิกชุมชน ผู้เข้าอบรม นักเรียน ครัวเรือน')}
                                ${this.rowInput(row, 'groupSize', 'จำนวนคนในกลุ่มทั้งหมด', 'number', '0')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-arrow-right-to-bracket text-chula mr-2"></i>Stage 2: Inputs และ Outputs</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                ${this.rowTextarea(row, 'inputDescription', 'สิ่งที่ลงทุน/สนับสนุน', 'เงิน เวลา อุปกรณ์ องค์ความรู้ หรือทรัพยากรที่ผู้มีส่วนเกี่ยวข้องลงทุน')}
                                ${this.rowTextarea(row, 'outputSummary', 'Output เชิงตัวเลข', 'เช่น จัดอบรม 3 รุ่น ผู้เข้าร่วม 120 คน ผลิตคู่มือ 1 ชุด')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-coins text-chula mr-2"></i>Stage 3: Outcome Value</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                ${this.rowInput(row, 'investment', 'มูลค่าการลงทุนรวม (บาท)', 'number', '0.00')}
                                ${this.rowInput(row, 'quantity', 'จำนวนผู้ได้รับ outcome', 'number', '0')}
                                ${this.rowInput(row, 'monetaryValue', 'มูลค่าต่อคนต่อปี (บาท)', 'number', '0.00')}
                                ${this.rowInput(row, 'changeDepth', 'จำนวน/ระดับการเปลี่ยนแปลงต่อคน (เพื่อความโปร่งใส)', 'text', 'เช่น รายได้เพิ่ม 20%')}
                                ${this.rowInput(row, 'weighting', 'น้ำหนักความสำคัญ (1-10, สะท้อนใน monetary value)', 'number', '1-10')}
                                ${this.rowInput(row, 'outcomeDescription', 'Outcome description', 'text', 'การเปลี่ยนแปลงที่เกิดขึ้นกับ stakeholder')}
                                ${this.rowInput(row, 'duration', 'ระยะเวลา outcome (ปี)', 'number', '1-6')}
                                <div>
                                    <label class="form-label">Outcome เริ่มเมื่อใด</label>
                                    <select class="form-control" data-sroi-row="${row.id}" data-sroi-field="outcomeStart">
                                        <option value="period-activity" ${row.outcomeStart === 'period-activity' ? 'selected' : ''}>ปีที่ดำเนินกิจกรรม</option>
                                        <option value="period-after" ${row.outcomeStart === 'period-after' ? 'selected' : ''}>ปีถัดจากกิจกรรม</option>
                                    </select>
                                </div>
                                ${this.rowInput(row, 'discountRate', 'Discount rate (%)', 'number', '3.5')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-scale-balanced text-chula mr-2"></i>Impact Adjustment</h4>
                            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                                ${this.rowInput(row, 'deadweight', 'Deadweight (%)', 'number', '0')}
                                ${this.rowInput(row, 'displacement', 'Displacement (%)', 'number', '0')}
                                ${this.rowInput(row, 'attribution', 'Attribution (%)', 'number', '0')}
                                ${this.rowInput(row, 'dropoff', 'Drop-off ต่อปี (%)', 'number', '0')}
                            </div>
                        </div>
                        <div>
                            <h4 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-file-signature text-chula mr-2"></i>หลักฐานและวิธีประเมินมูลค่า</h4>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                ${this.rowTextarea(row, 'valuationApproach', 'Valuation approach / financial proxy', 'ระบุวิธีประเมินมูลค่า เช่น market price, avoided cost หรือ proxy')}
                                ${this.rowTextarea(row, 'indicatorSource', 'Indicator และแหล่งข้อมูล', 'ระบุว่าจะวัด outcome อย่างไรและใช้ข้อมูลจากแหล่งใด')}
                            </div>
                        </div>
                        <div class="validation-message" id="row-validation-${row.id}"></div>
                    </div>
                </details>
            `;
        }).join('');

        this.updateSROIValidation();
        this.calculateSROIPreview();
    },

    rowInput(row, field, label, type, placeholder) {
        const constraints = {
            groupSize: 'min="0"',
            investment: 'min="0"',
            quantity: 'min="0"',
            monetaryValue: 'min="0"',
            duration: 'min="1" max="6"',
            weighting: 'min="1" max="10"',
            discountRate: 'min="0" max="100"',
            deadweight: 'min="0" max="100"',
            displacement: 'min="0" max="100"',
            attribution: 'min="0" max="100"',
            dropoff: 'min="0" max="100"'
        };

        return `
            <div>
                <label class="form-label">${this.escapeHTML(label)}</label>
                <input type="${type}" class="form-control ${type === 'number' ? 'text-right font-mono' : ''}" value="${this.escapeHTML(row[field])}" placeholder="${this.escapeHTML(placeholder)}" data-sroi-row="${row.id}" data-sroi-field="${field}" ${type === 'number' ? `step="any" ${constraints[field] || ''}` : ''}>
            </div>
        `;
    },

    rowTextarea(row, field, label, placeholder) {
        return `
            <div>
                <label class="form-label">${this.escapeHTML(label)}</label>
                <textarea rows="3" class="form-control resize-none" placeholder="${this.escapeHTML(placeholder)}" data-sroi-row="${row.id}" data-sroi-field="${field}">${this.escapeHTML(row[field])}</textarea>
            </div>
        `;
    },

    addSROIRow() {
        this.sroiRows.push(this.createSROIRow());
        this.renderSROIRows();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    removeSROIRow(rowId) {
        this.sroiRows = this.sroiRows.filter(row => row.id !== rowId);
        if (this.sroiRows.length === 0) this.sroiRows = [this.createSROIRow()];
        this.renderSROIRows();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    updateSROIRow(rowId, field, value) {
        const row = this.sroiRows.find(item => item.id === rowId);
        if (!row) return;
        row[field] = value;
        this.calculateSROIPreview();
        this.updateSROIValidation();
        this.scheduleSave();
        this.updateLiveSummary();
    },

    getValue(id) {
        return document.getElementById(id)?.value || '';
    },

    setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.innerText = value || '-';
    },

    parseNumberValue(value) {
        return parseFloat(value) || 0;
    },

    clampPercent(value) {
        return Math.max(0, Math.min(100, this.parseNumberValue(value))) / 100;
    },

    // Shared with the dashboard's draft-resume prompt (hasMeaningfulContent()) so
    // "started" means the same thing everywhere.
    isSROIRowStarted,

    getActiveSROIRows() {
        return this.sroiRows.filter(row => this.isSROIRowStarted(row));
    },

    calculateSROIRow(row) {
        const investment = Math.max(0, this.parseNumberValue(row.investment));
        const quantity = Math.max(0, this.parseNumberValue(row.quantity));
        const monetaryValue = Math.max(0, this.parseNumberValue(row.monetaryValue));
        const duration = Math.max(1, Math.min(6, Math.round(this.parseNumberValue(row.duration) || 1)));
        const discountRate = this.clampPercent(row.discountRate);
        const deadweight = this.clampPercent(row.deadweight);
        const displacement = this.clampPercent(row.displacement);
        const attribution = this.clampPercent(row.attribution);
        const dropoff = this.clampPercent(row.dropoff);
        const startOffset = row.outcomeStart === 'period-after' ? 1 : 0;
        const adjustedAnnualValue = quantity * monetaryValue * (1 - deadweight) * (1 - displacement) * (1 - attribution);
        const yearlyValues = [];
        let totalPV = 0;

        for (let calendarYear = 0; calendarYear < 6; calendarYear++) {
            if (calendarYear < startOffset) {
                yearlyValues.push(0);
                continue;
            }

            const activeYear = calendarYear - startOffset;
            if (activeYear >= duration) {
                yearlyValues.push(0);
                continue;
            }

            const droppedValue = adjustedAnnualValue * Math.pow(1 - dropoff, activeYear);
            const presentValue = droppedValue / Math.pow(1 + discountRate, calendarYear);
            yearlyValues.push(presentValue);
            totalPV += presentValue;
        }

        return {
            row,
            investment,
            quantity,
            monetaryValue,
            duration,
            discountRate,
            deadweight,
            displacement,
            attribution,
            dropoff,
            adjustedAnnualValue,
            yearlyValues,
            totalPV,
            netPresentValue: totalPV - investment,
            sroiRatio: investment > 0 ? totalPV / investment : 0
        };
    },

    calculateSROI() {
        const rows = this.getActiveSROIRows().map(row => this.calculateSROIRow(row));
        const investment = rows.reduce((sum, row) => sum + row.investment, 0);
        const totalPV = rows.reduce((sum, row) => sum + row.totalPV, 0);
        const adjustedAnnualValue = rows.reduce((sum, row) => sum + row.adjustedAnnualValue, 0);
        const yearlyValues = Array.from({ length: 6 }, (_, index) => rows.reduce((sum, row) => sum + row.yearlyValues[index], 0));

        return {
            rows,
            investment,
            adjustedAnnualValue,
            totalPV,
            netPresentValue: totalPV - investment,
            sroiRatio: investment > 0 ? totalPV / investment : 0,
            yearlyValues
        };
    },

    calculateSROIPreview() {
        const calc = this.calculateSROI();
        const ratioEl = document.getElementById('preview_sroi_ratio');
        const pvEl = document.getElementById('preview_total_pv');
        const npvEl = document.getElementById('preview_npv');
        if (ratioEl) ratioEl.innerText = `1 : ${calc.sroiRatio.toFixed(2)}`;
        if (pvEl) pvEl.innerText = `${this.formatMoney(calc.totalPV)} บาท`;
        if (npvEl) npvEl.innerText = `${this.formatMoney(calc.netPresentValue)} บาท`;
        this.updateFormulaBreakdown(calc);
        this.updateLiveSummary();
    },

    validateSROIRow(result) {
        const row = result.row;
        const messages = [];
        const groupSize = this.parseNumberValue(row.groupSize);
        const quantity = this.parseNumberValue(row.quantity);
        const duration = this.parseNumberValue(row.duration);
        const percentageFields = [
            ['deadweight', 'Deadweight'],
            ['displacement', 'Displacement'],
            ['attribution', 'Attribution'],
            ['dropoff', 'Drop-off'],
            ['discountRate', 'Discount rate']
        ];

        if (result.investment <= 0) messages.push('กรอกมูลค่าการลงทุนรวม');
        if (quantity <= 0) messages.push('กรอกจำนวนผู้ได้รับ outcome');
        if (result.monetaryValue <= 0) messages.push('กรอกมูลค่าต่อคนต่อปี');
        if (duration < 1 || duration > 6) messages.push('ระยะเวลา outcome ต้องอยู่ระหว่าง 1-6 ปี');
        if (groupSize > 0 && quantity > groupSize) messages.push('จำนวนผู้ได้รับ outcome มากกว่าขนาด stakeholder group');
        if (row.weighting !== '' && (this.parseNumberValue(row.weighting) < 1 || this.parseNumberValue(row.weighting) > 10)) {
            messages.push('น้ำหนักความสำคัญควรอยู่ระหว่าง 1-10');
        }
        percentageFields.forEach(([field, label]) => {
            const value = this.parseNumberValue(row[field]);
            if (value < 0 || value > 100) messages.push(`${label} ต้องอยู่ระหว่าง 0-100%`);
        });
        return messages;
    },

    updateSROIValidation() {
        const activeRows = this.getActiveSROIRows();
        const activeIds = new Set(activeRows.map(row => row.id));
        const results = activeRows.map(row => this.calculateSROIRow(row));
        const allMessages = [];

        this.sroiRows.forEach((row) => {
            if (activeIds.has(row.id)) return;
            const el = document.getElementById(`row-validation-${row.id}`);
            if (el) {
                el.className = 'validation-message validation-neutral';
                el.innerHTML = '<i class="fa-solid fa-circle-info mr-1"></i>แถวนี้ยังว่าง ระบบจะยังไม่นำไปรวมในการคำนวณ';
            }
        });

        results.forEach((result) => {
            const rowNumber = this.sroiRows.findIndex(row => row.id === result.row.id) + 1;
            const messages = this.validateSROIRow(result);
            const el = document.getElementById(`row-validation-${result.row.id}`);
            if (el) {
                el.className = messages.length ? 'validation-message validation-error' : 'validation-message validation-ok';
                el.innerHTML = messages.length
                    ? `<i class="fa-solid fa-triangle-exclamation mr-1"></i>${messages.map(message => this.escapeHTML(message)).join(' · ')}`
                    : '<i class="fa-solid fa-circle-check mr-1"></i>ข้อมูลแถวนี้พร้อมคำนวณ';
            }
            messages.forEach(message => allMessages.push({ rowNumber, message }));
        });

        const list = document.getElementById('sroi-validation-list');
        const panel = document.getElementById('sroi-validation-panel');
        const icon = document.getElementById('sroi-validation-icon');
        const title = document.getElementById('sroi-validation-title');
        const emptyRows = this.sroiRows.length - activeRows.length;
        if (list) {
            if (activeRows.length === 0) {
                list.innerHTML = '<p>กรอก outcome row อย่างน้อย 1 แถว โดยใส่ Investment, Quantity และ Monetary value</p>';
            } else if (allMessages.length) {
                list.innerHTML = allMessages.map(item => `
                    <div class="validation-item">
                        <span class="validation-row-pill">Row ${item.rowNumber}</span>
                        <span>${this.escapeHTML(item.message)}</span>
                    </div>
                `).join('');
            } else {
                list.innerHTML = `<p>คำนวณจาก ${activeRows.length} outcome row${emptyRows ? ` · ข้ามแถวว่าง ${emptyRows} แถว` : ''}</p>`;
            }
        }
        if (panel && icon && title) {
            const hasBlockingIssue = activeRows.length === 0 || allMessages.length > 0;
            panel.className = hasBlockingIssue ? 'sroi-validation-panel sroi-validation-panel-error' : 'sroi-validation-panel sroi-validation-panel-ok';
            icon.className = hasBlockingIssue ? 'fa-solid fa-circle-exclamation mt-1' : 'fa-solid fa-circle-check mt-1';
            title.innerText = hasBlockingIssue ? 'ต้องแก้ก่อนประมวลผลรายงาน' : 'ข้อมูลพร้อมคำนวณ';
        }
        return allMessages;
    },

    updateFormulaBreakdown(calc = this.calculateSROI()) {
        const container = document.getElementById('formula-breakdown');
        if (!container) return;
        const yearCards = calc.yearlyValues.map((value, index) => `
            <div class="pv-year-card">
                <span>Year ${index}</span>
                <strong>${this.formatMoney(value)}</strong>
            </div>
        `).join('');
        const rowList = calc.rows.map((result) => {
            const rowNumber = this.sroiRows.findIndex(row => row.id === result.row.id) + 1;
            return `
            <tr class="border-t">
                <td class="px-2 py-1">Row ${rowNumber}</td>
                <td class="px-2 py-1">${this.escapeHTML(result.row.stakeholderGroup || result.row.outcomeDescription || '-')}</td>
                <td class="px-2 py-1 text-right font-mono">${this.formatMoney(result.adjustedAnnualValue)}</td>
                <td class="px-2 py-1 text-right font-mono">${this.formatMoney(result.totalPV)}</td>
            </tr>
        `;
        }).join('') || '<tr class="border-t"><td colspan="4" class="px-2 py-3 text-center text-gray-500">ยังไม่มี outcome row ที่นำมาคำนวณ</td></tr>';

        container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
                <div class="bg-gray-50 rounded-lg border border-gray-100 p-4">
                    <h5 class="font-bold text-gray-900 mb-2">สูตรที่ใช้</h5>
                    <div class="space-y-2 text-xs text-gray-600 leading-relaxed">
                        <p>1. มูลค่ารายปี = Quantity x Monetary value</p>
                        <p>2. หัก Deadweight, Displacement และ Attribution</p>
                        <p>3. กระจายตาม Duration, Drop-off และ Discount rate เพื่อรวมเป็น PV</p>
                    </div>
                    <div class="mt-4 text-sm space-y-1">
                        <div class="flex justify-between"><span>Total PV</span><strong>${this.formatMoney(calc.totalPV)} บาท</strong></div>
                        <div class="flex justify-between"><span>Investment</span><strong>${this.formatMoney(calc.investment)} บาท</strong></div>
                        <div class="flex justify-between"><span>NPV</span><strong>${this.formatMoney(calc.netPresentValue)} บาท</strong></div>
                    </div>
                </div>
                <div class="bg-gray-50 rounded-lg border border-gray-100 p-4">
                    <h5 class="font-bold text-gray-900 mb-3"><i class="fa-solid fa-calendar-days text-chula mr-2"></i>Present value by year</h5>
                    <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">${yearCards}</div>
                </div>
            </div>
            <div class="mt-4 bg-gray-50 rounded-lg border border-gray-100 overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead class="bg-white">
                            <tr>
                                <th class="px-2 py-2 text-left">Row</th>
                                <th class="px-2 py-2 text-left">Stakeholder/outcome</th>
                                <th class="px-2 py-2 text-right">Adjusted annual</th>
                                <th class="px-2 py-2 text-right">PV</th>
                            </tr>
                        </thead>
                        <tbody>${rowList}</tbody>
                    </table>
            </div>
        `;
    },

    // Re-exposed as methods so the ~25 existing `this.formatMoney(...)` /
    // `this.escapeHTML(...)` calls in the template strings below keep working.
    // The implementations live in lib/format.js, shared with dashboard.js.
    formatMoney,
    formatNumber,

    generateReport() {
        this.setText('r_projectName', this.getValue('m_projectName') || 'ไม่ได้ระบุชื่อโครงการ');
        this.setText('r_responsible', this.getValue('m_responsible'));
        this.setText('r_area', this.getValue('m_area'));
        this.setText('r_objective', this.getValue('m_objective'));

        // Audit line and team list. Blank for an unsaved project, which has neither.
        this.setText('r_updated_meta', formatUpdatedMeta(this.projectMeta));

        const team = (this.projectMeta?.project_members ?? [])
            .map(member => {
                const name = String(member.member_name ?? '').trim();
                const email = String(member.member_email ?? '').trim();
                if (!email) return '';
                return name ? `${name} (${email})` : email;
            })
            .filter(Boolean);
        this.setText(
            'r_team',
            team.length ? `ผู้ร่วมวิจัย: ${team.join(', ')}` : ''
        );

        const selectedSDGs = Array.from(document.querySelectorAll('.sdg-checkbox:checked')).map(cb => cb.value);
        const sdgContainer = document.getElementById('r_sdgs');
        if(selectedSDGs.length > 0) {
            sdgContainer.innerHTML = selectedSDGs.map(sdg => `<span class="bg-gray-100 text-chula-darker border border-chula-light px-3 py-1 rounded-full text-xs font-semibold">${this.escapeHTML(sdg)}</span>`).join('');
        } else {
            sdgContainer.innerHTML = '<span class="text-gray-500 italic">ไม่ได้ระบุ</span>';
        }

        this.setText('r_inputs', this.getValue('i_inputs'));
        this.setText('r_knowledge', this.getValue('i_knowledge'));
        this.setText('r_stakeholders', this.getValue('i_stakeholders'));
        this.setText('r_activities', this.getValue('i_activities'));
        this.setText('r_output', this.getValue('i_output'));
        this.setText('r_output_sdg', this.getValue('i_output_sdg'));
        this.setText('r_outcome', this.getValue('i_outcome'));
        this.setText('r_outcome_stakeholders', this.getValue('i_outcome_stakeholders'));
        this.setText('r_impact_economic', this.getValue('i_impact_economic'));
        this.setText('r_impact_social', this.getValue('i_impact_social'));
        this.setText('r_impact_environment', this.getValue('i_impact_environment'));
        this.setText('r_toc_statement', this.getValue('i_toc_statement'));
        this.setText('r_indicator_output', this.getValue('i_indicator_output'));
        this.setText('r_indicator_outcome', this.getValue('i_indicator_outcome'));
        this.setText('r_indicator_impact', this.getValue('i_indicator_impact'));

        const firstActivityImage = this.activityImages.find(image => image.src)?.src || this.uploadedImage;
        if(firstActivityImage) {
            const img = document.getElementById('r_photo');
            img.src = firstActivityImage;
            img.classList.remove('hidden');
        } else {
            const img = document.getElementById('r_photo');
            img.src = '';
            img.classList.add('hidden');
        }
        this.setText('r_quote', this.getValue('sv_quote') || 'ไม่มีข้อมูลสัมภาษณ์');

        const calc = this.calculateSROI();
        const rowContainer = document.getElementById('r_sroi_rows');
        if (rowContainer) {
            rowContainer.innerHTML = calc.rows.map((result, index) => `
                <div class="report-cell">
                    <strong class="report-label">SROI row ${index + 1}</strong>
                    <div class="space-y-1">
                        <p><span class="font-semibold">Stakeholder:</span> ${this.escapeHTML(result.row.stakeholderGroup || '-')} (${this.formatNumber(this.parseNumberValue(result.row.groupSize))} คน)</p>
                        <p><span class="font-semibold">Input/output:</span> ${this.escapeHTML(result.row.inputDescription || '-')} / ${this.escapeHTML(result.row.outputSummary || '-')}</p>
                        <p><span class="font-semibold">Outcome:</span> ${this.escapeHTML(result.row.outcomeDescription || '-')}</p>
                        <p><span class="font-semibold">Depth/weighting:</span> ${this.escapeHTML(result.row.changeDepth || '-')} / ${this.escapeHTML(result.row.weighting || '-')}</p>
                        <p><span class="font-semibold">PV:</span> ${this.formatMoney(result.totalPV)} บาท · <span class="font-semibold">Investment:</span> ${this.formatMoney(result.investment)} บาท</p>
                    </div>
                </div>
            `).join('');
        }

        this.setText('r_calc_quantity', this.formatNumber(calc.rows.reduce((sum, row) => sum + row.quantity, 0)));
        this.setText('r_calc_monetary', this.formatMoney(calc.rows.reduce((sum, row) => sum + row.monetaryValue, 0)));
        this.setText('r_calc_adjusted_annual', this.formatMoney(calc.adjustedAnnualValue));
        this.setText('r_val_total_pv', this.formatMoney(calc.totalPV));
        this.setText('r_val_npv', this.formatMoney(calc.netPresentValue));
        this.setText('r_val_invest', this.formatMoney(calc.investment));
        this.setText('r_calc_assumptions', `${calc.rows.length} SROI outcome row(s), Discount/adjustment applied per row`);
        this.setText('r_sroi_ratio', calc.sroiRatio.toFixed(2));
        this.setText('r_sroi_value', calc.sroiRatio.toFixed(2));
    },

    attachAutoSaveListeners() {
        if (this.autosaveAttached) return;
        this.autosaveAttached = true;

        document.addEventListener('input', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (target.id === 'sdg-search') {
                this.filterSDGs();
                return;
            }

            if (target.id === 'boundary-search') {
                return;
            }

            if (target.id === 'm_area' && this.getValue('m_lat') && target.value !== this.getValue('m_place_name')) {
                this.clearAreaLocation();
            }

            if (target.id === 'm_location_label') {
                this.refreshSelectedLocationLabel();
                this.scheduleSave();
                this.updateLiveSummary();
                return;
            }

            if (target.classList.contains('objective-input')) {
                this.updateObjectiveHidden();
                this.scheduleSave();
                this.updateLiveSummary();
                return;
            }

            if (target.id === 'sv_key_takeaway') {
                this.updateKeyTakeawayCounter();
                this.scheduleSave();
                this.updateLiveSummary();
                return;
            }

            if (target.dataset.sroiRow && target.dataset.sroiField) {
                this.updateSROIRow(target.dataset.sroiRow, target.dataset.sroiField, target.value);
                return;
            }

            if (target.classList.contains('sdg-reason')) {
                this.scheduleSave();
                this.updateLiveSummary();
                return;
            }

            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) && target.type !== 'file') {
                this.scheduleSave();
                this.calculateSROIPreview();
                this.updateLiveSummary();
            }
        });

        document.addEventListener('change', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (target.classList.contains('sdg-checkbox')) {
                this.handleSDGChange();
                return;
            }

            if (target.classList.contains('sdg-target-checkbox')) {
                this.updateSDGTargetsHidden();
                this.scheduleSave();
                this.updateLiveSummary();
                return;
            }

            if (target.id === 'boundary-admin-level') {
                if (this.mapSelectionMode === 'boundary') this.loadVisibleBoundaries({ force: true });
                return;
            }

            if (target.dataset.sroiRow && target.dataset.sroiField) {
                this.updateSROIRow(target.dataset.sroiRow, target.dataset.sroiField, target.value);
                return;
            }

            if (target.tagName === 'SELECT') {
                this.scheduleSave();
                this.calculateSROIPreview();
                this.updateLiveSummary();
            }
        });
    },

    scheduleSave() {
        this.isDirty = true;
        window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => this.saveDraft(), 250);
        const status = document.getElementById('draft-status');
        if (status) status.innerText = 'กำลังบันทึก...';
    },

    saveDraft() {
        localStorage.setItem(getDraftKey(), JSON.stringify(serialiseAssessment(this)));
        const status = document.getElementById('draft-status');
        if (status) status.innerText = 'บันทึก draft แล้ว';
    },

    loadDraft() {
        const rawDraft = localStorage.getItem(getDraftKey());
        if (!rawDraft) return;

        try {
            // For an existing project (?id=...), loadExistingProject() runs right after
            // this during page load and overwrites currentStep from the saved row anyway
            // -- setting it here only matters for resuming a "new project" draft, where
            // it's what lets "Continue draft" reopen on the step the user left off at.
            const { currentStep } = deserialiseAssessment(normaliseSnapshot(JSON.parse(rawDraft)), this);
            this.currentStep = currentStep;
        } catch (error) {
            console.warn('Could not load SROI draft', error);
        }
    },

    updateLiveSummary() {
        this.updateProjectHeader();
    },

    updateProjectHeader() {
        const projectName = this.getValue('m_projectName').trim();
        this.setText('project-title-chip', projectName || 'ยังไม่ได้ตั้งชื่อโครงการ');
    },

    exportPDF() {
        const element = document.getElementById('report-container');
        const opt = {
            margin:       10,
            filename:     'SROI_Report.pdf',
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2, useCORS: true },
            jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
        };

        const btn = document.querySelector('button[onclick="appState.exportPDF()"]');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังสร้าง PDF...';
        
        html2pdf().set(opt).from(element).save().then(() => {
            btn.innerHTML = originalText;
        });
    },

    // The step-5 recheck modal's ยืนยัน button is the only entry point -- it shows the
    // whole report before committing, which already IS the confirmation step, so this
    // needs no confirm() of its own. There is deliberately no save button on step 6;
    // see the comment in index.html above #step-6.
    async confirmAndSave() {
        const btn = document.getElementById('modal-btn-confirm');
        const originalText = btn ? btn.innerHTML : 'ยืนยัน';
        if (btn) btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i>กำลังบันทึก...';

        // Saving from the modal finishes the assessment, so the persisted snapshot must
        // say step 6 -- otherwise reopening the project from the dashboard lands back on
        // step 5 (buildProjectPayload() below reads currentStep at call time).
        this.currentStep = this.totalSteps;

        // Read the draft key BEFORE saving. For a first save saveProjectData() calls
        // history.replaceState() to put ?id=<newId> in the URL, which changes what
        // getDraftKey() returns -- clearing it afterwards would delete a key that never
        // existed and strand the real 'sroi-evaluation-draft-new' entry forever.
        const draftKeyToClear = getDraftKey();

        // Captures every field, the raw SROI rows, the map/location data, and the
        // SDG reasons -- all of which the old hand-written list silently dropped.
        const isSuccess = await saveProjectData(buildProjectPayload(this));

        if (btn) btn.innerHTML = originalText;

        if (!isSuccess) {
            alert('เกิดข้อผิดพลาดในการบันทึกข้อมูล กรุณาลองใหม่อีกครั้ง (Error saving data)');
            return;
        }

        localStorage.removeItem(draftKeyToClear);

        // Saving from step 5 is what produces the report, so land the user on it.
        // currentStep was already bumped to totalSteps above, before the payload was
        // built, so the persisted snapshot matches what's shown here.
        this.hideRecheckModal();
        this.isViewMode = true;
        this.updateStepUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });

        // Closing the modal onto the finished report is itself the confirmation --
        // no further alert needed.
    },

    // Step 5's "สรุปผลเป็นรายงาน" opens this instead of saving straight away: the
    // report is rendered into the modal so it can be read before anything is committed.
    // generateReport() writes into #report-container on the hidden step 6, and the
    // markup is copied out of there -- so the modal always matches what step 6 will show.
    showRecheckModal() {
        this.generateReport();
        const reportContainer = document.getElementById('report-container');
        const modalContent = document.getElementById('modal-report-content');
        const modal = document.getElementById('recheck-modal');
        if (!reportContainer || !modalContent || !modal) return;

        modalContent.innerHTML = reportContainer.innerHTML;
        modal.classList.remove('hidden');
    },

    hideRecheckModal() {
        document.getElementById('recheck-modal')?.classList.add('hidden');
    },

    escapeHTML
};


// ==========================================
// SUPABASE LOGIC
// ==========================================

// The browser's back/forward cache can restore this whole page -- DOM, form values,
// whatever step was showing -- from memory without re-running any of the init logic
// below (no DOMContentLoaded fires). Clicking "New Assessment" then "back" then
// "New Assessment" again could land on a stale bfcache snapshot: old field values,
// old checked SDGs, whatever step it was left on -- including step 6, bypassing
// every guard in goToStep()/initializeNewProject() because none of that code reran.
// Forcing a real reload when a bfcache restore is detected guarantees "new" always
// actually starts fresh.
window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        window.location.reload();
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    appState.init();

    const urlParams = new URLSearchParams(window.location.search);
    const isLocalInputFormTest =
        urlParams.get('test') === 'input-form' &&
        ['127.0.0.1', 'localhost'].includes(window.location.hostname);

    if (isLocalInputFormTest) {
        const identity = Object.freeze({
            userId: 'local-input-form-test',
            email: 'input-form-test@local.test',
            role: 'researcher',
            displayName: 'Input Form Test'
        });

        appState.identity = identity;
        appState.showView('view-app');
        document.getElementById('user-email-display').innerText = identity.email;
        document.getElementById('nav-user').classList.remove('hidden');
        initializeNewProject(identity, urlParams.get('fresh') !== '0');

        const requestedStep = Number(urlParams.get('step'));
        if (requestedStep >= 1 && requestedStep < appState.totalSteps) {
            appState.currentStep = requestedStep;
            appState.updateStepUI();
        }
        return;
    }

    // Unauthenticated visitors get the landing page rather than being redirected,
    // so the two login buttons are reachable. redirectOnMissing: false is what makes
    // that possible -- loadIdentity() would otherwise send them to '/'.
    const identity = await loadIdentity({ redirectOnMissing: false });

    if (!identity) {
        console.log('No active session. Showing landing page.');
        appState.showView('view-landing');
        return;
    }

    appState.identity = identity;

    const projectId = urlParams.get('id');
    const isNew = urlParams.get('new');
    // Set only by the dashboard's "start new assessment" choice (never by "continue
    // draft" or by the plain new-assessment link when there was no draft to ask
    // about) -- see index.html?new=true[&fresh=1] and dashboard.js.
    const isFresh = urlParams.get('fresh') === '1';
    // Set only by the dashboard's per-project "continue unsaved edit" choice -- see
    // index.html?id=...&resumeDraft=1 and dashboard.js.
    const resumeDraft = urlParams.get('resumeDraft') === '1';

    if (projectId || isNew) {
        appState.showView('view-app');
        appState.updateStepUI();

        document.getElementById('user-email-display').innerText = identity.email;
        document.getElementById('nav-user').classList.remove('hidden');

        if (projectId) {
            await loadExistingProject(projectId, identity, resumeDraft);
        } else {
            initializeNewProject(identity, isFresh);
        }
    } else {
        window.location.href = '/dashboard.html';
    }
});

/**
 * @param id
 * @param identity
 * @param resumeDraft - true only when the dashboard's per-project prompt (see
 *   dashboard.js) offered "continue unsaved edit" over a local draft for THIS
 *   project's id (getDraftKey() -> 'sroi-evaluation-draft-<id>') and the user picked
 *   it. appState.init() -> loadDraft() already restored that draft's fields, SROI
 *   rows, and currentStep into the form before this function runs -- so resuming
 *   means leaving all of that alone and only pulling permissions/team data from the
 *   server row. The normal path (false) discards any local draft for this id and
 *   shows the server's last explicitly-saved version, as before.
 */
async function loadExistingProject(id, identity, resumeDraft) {
    // No .eq('user_email', ...) any more -- that filter would hide projects shared
    // with this user. RLS (0005) decides what is visible; a row we may not see
    // simply comes back empty.
    //
    // maybeSingle() rather than single(): with collaboration, "exists but not yours"
    // is a normal outcome and must not surface as a thrown error.
    const { data: project, error } = await supabase
        .from('projects')
        .select('*, project_members(user_id, member_email, member_name, added_at)')
        .eq('id', id)
        .maybeSingle();

    if (error) {
        console.error("Error loading project:", error);
        alert("ไม่สามารถโหลดข้อมูลโครงการได้ (Could not load the project.)");
        return;
    }

    if (!project) {
        alert("ไม่พบโครงการนี้ หรือคุณไม่มีสิทธิ์เข้าถึง (Project not found, or you don't have access.)");
        window.location.href = '/dashboard.html';
        return;
    }

    if (resumeDraft) {
        // Keep editing exactly where the local draft left off -- form fields, SROI
        // rows, and currentStep were already restored by loadDraft() during init().
        appState.isViewMode = false;
    } else {
        // Discarding whatever local draft exists for this id (there may be none,
        // which is a harmless no-op) before loading the server's version, so a stale
        // draft can't reappear the next time this project is opened normally.
        localStorage.removeItem(getDraftKey());

        // normaliseSnapshot() upgrades the old { inputs, sroiCalculations } shape and
        // recovers the raw SROI rows from sroiCalculations.rows[].row. Skipping it would
        // load a legacy project with an empty SROI table, and the next save would then
        // write zeros over the real stored results.
        const snapshot = normaliseSnapshot(project.assessment_data);

        if (snapshot) {
            const { currentStep } = deserialiseAssessment(snapshot, appState);
            appState.currentStep = Math.min(Math.max(currentStep, 1), appState.totalSteps);
        } else if (project.project_name) {
            const projectNameInput = document.getElementById('m_projectName');
            if (projectNameInput) projectNameInput.value = project.project_name;
            appState.currentStep = 1;
        }

        // Saved projects open read-only so an accidental keystroke cannot alter a
        // finished assessment; "แก้ไขข้อมูล" now reveals a fully populated, genuinely
        // editable form. applyProjectAccess() decides whether that button appears at all.
        appState.isViewMode = true;
    }

    appState.applyProjectAccess(identity, project);
    appState.updateStepUI();
    appState.calculateSROIPreview();
    appState.updateSelectedSDGs();
    appState.updateLiveSummary();
}

/**
 * @param identity
 * @param fresh - true only when the dashboard's "start new assessment" choice was
 *   picked over an existing draft (see index.html?new=true&fresh=1 in the
 *   DOMContentLoaded handler above). Every never-saved project shares one draft key
 *   ('sroi-evaluation-draft-new', see getDraftKey()), and appState.init() ->
 *   loadDraft() already ran before we knew "new" vs "existing" -- so by this point a
 *   previous, unrelated, abandoned new-project draft may already be sitting in the
 *   form (and appState.currentStep may already be wherever that draft left off).
 *   fresh=true wipes both the stored draft and what loadDraft() just populated, so
 *   "start new" always actually means new. fresh=false ("continue draft", or a plain
 *   new-assessment click when there was nothing to resume) leaves all of that alone.
 */
function initializeNewProject(identity, fresh) {
    if (fresh) {
        localStorage.removeItem('sroi-evaluation-draft-new');

        appState.currentStep = 1;
        appState.uploadedImage = null;
        appState.activityImages = [];
        appState.sroiRows = [appState.createSROIRow()];
        appState.isViewMode = false;
        appState.pendingMembers = [];

        document.querySelectorAll('input, textarea').forEach(el => {
            // Checkbox/radio "value" is a fixed identifier (e.g. "SDG 2: ..."), not user
            // text -- clearing it would permanently break lookups like generateReport()'s
            // .sdg-checkbox:checked -> cb.value, even after the box is checked again.
            if (el.type !== 'file' && el.type !== 'checkbox' && el.type !== 'radio') el.value = '';
        });
        document.querySelectorAll('select').forEach(el => { el.selectedIndex = 0; });
        document.querySelectorAll('.sdg-checkbox').forEach(cb => { cb.checked = false; });

        appState.renderObjectiveInputs(['']);
        appState.updateKeyTakeawayCounter();
        appState.renderActivityPhotoSlots();
        appState.renderSROIRows();
        appState.updateSelectedSDGs();
    } else {
        appState.isViewMode = false;
    }

    // A brand-new project has no row yet, so the creator is treated as its owner.
    appState.applyProjectAccess(identity, null);
    appState.updateStepUI();
}

export async function saveProjectData(currentProjectData) {
    const urlParams = new URLSearchParams(window.location.search);
    let projectId = urlParams.get('id');
    
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
        alert("Your session has expired. Please log in again.");
        return false;
    }

    if (projectId) {
        // Access is enforced by RLS via owner_id / project_members (see
        // supabase/migrations/0005_rls_v2.sql), not by user_email -- that column is only
        // a denormalised fallback and does not track collaborators or ownership
        // transfers. Filtering on it here would reject legitimate updates RLS allows.
        const { data, error } = await supabase
            .from('projects')
            .update({
                // Denormalised copy that the dashboard and admin lists render. Without
                // it, renaming a project in step 1 saved the new name into
                // assessment_data but left every card still showing the old one.
                // updated_at / updated_by are deliberately NOT sent -- the
                // projects_set_audit_fields trigger owns them and ignores client values.
                project_name: document.getElementById('m_projectName')?.value || 'ไม่ได้ระบุชื่อโครงการ',
                assessment_data: currentProjectData,
                last_page_url: window.location.href
            })
            .eq('id', projectId)
            .select();

        if (error) {
            console.error("Update failed:", error);
            return false;
        }

        if (!data || data.length === 0) {
            console.error("Update affected no rows: project missing or blocked by RLS.");
            return false;
        }

        console.log("Project successfully updated!");
        return true;
    } else {
        const projectNameInput = document.getElementById('m_projectName');
        const finalProjectName = (projectNameInput && projectNameInput.value) ? projectNameInput.value : "ไม่ได้ระบุชื่อโครงการ";

        const { data, error } = await supabase
            .from('projects')
            .insert([{
                // owner_id is what RLS checks (supabase/migrations/0005_rls_v2.sql);
                // user_email is kept only as a readable fallback, not for access control.
                owner_id: session.user.id,
                user_email: session.user.email,
                project_name: finalProjectName,
                assessment_data: currentProjectData,
                last_page_url: window.location.href
            }])
            .select();
            
        if (error) {
            console.error("Insert failed:", error);
            return false;
        } else if (data && data.length > 0) {
            console.log("New project saved!");
            const newId = data[0].id;
            const newUrl = `${window.location.pathname}?id=${newId}`;
            window.history.replaceState({}, '', newUrl);

            // Researchers queued via appState.pendingMembers while the project didn't
            // exist yet -- invite them for real now that it does. Best-effort: a failed
            // invite here does not undo the save, since the project itself already
            // exists successfully; it's logged so it isn't silently lost.
            if (appState.pendingMembers.length > 0) {
                for (const { name, email } of appState.pendingMembers) {
                    const { error: inviteError } = await supabase.rpc('add_project_researcher', {
                        p_project_id: newId,
                        p_email: email
                    });
                    if (inviteError) {
                        console.error(`Could not invite queued researcher ${email}:`, inviteError);
                        continue;
                    }
                    if (name) {
                        const { error: nameError } = await supabase.rpc('set_project_researcher_name', {
                            p_project_id: newId,
                            p_email: email,
                            p_name: name
                        });
                        if (nameError) console.error(`Could not save name for ${email}:`, nameError);
                    }
                }
                appState.pendingMembers = [];
            }

            return true;
        }
    }
}
